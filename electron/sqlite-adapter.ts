import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementResultingChanges } from "node:sqlite"

type Row = Record<string, SQLOutputValue>
type NamedParameters = Record<string, SQLInputValue>

function isBinary(value: unknown): value is NodeJS.ArrayBufferView {
  return ArrayBuffer.isView(value)
}

function normalizeValue(value: unknown): SQLInputValue {
  if (value == null) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value
  if (typeof value === "boolean") return value ? 1 : 0
  if (isBinary(value)) return value
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}

function normalizeArguments(values: readonly unknown[]): { named?: NamedParameters; positional: SQLInputValue[] } {
  const [first, ...rest] = values
  if (first != null && typeof first === "object" && !Array.isArray(first) && !isBinary(first) && !(first instanceof Date)) {
    const named: NamedParameters = {}
    for (const [key, value] of Object.entries(first)) named[key] = normalizeValue(value)
    return { named, positional: rest.map(normalizeValue) }
  }
  return { positional: values.map(normalizeValue) }
}

export class Statement {
  private readonly statement: ReturnType<DatabaseSync["prepare"]>

  constructor(statement: ReturnType<DatabaseSync["prepare"]>) {
    this.statement = statement
  }

  all(...values: unknown[]): Row[] {
    const parameters = normalizeArguments(values)
    return parameters.named
      ? this.statement.all(parameters.named, ...parameters.positional)
      : this.statement.all(...parameters.positional)
  }

  get(...values: unknown[]): Row | undefined {
    const parameters = normalizeArguments(values)
    return parameters.named
      ? this.statement.get(parameters.named, ...parameters.positional)
      : this.statement.get(...parameters.positional)
  }

  run(...values: unknown[]): StatementResultingChanges {
    const parameters = normalizeArguments(values)
    return parameters.named
      ? this.statement.run(parameters.named, ...parameters.positional)
      : this.statement.run(...parameters.positional)
  }
}

export interface SqliteDatabaseOptions {
  readonly?: boolean
}

export class Database {
  private readonly native: DatabaseSync
  private savepointCounter = 0

  constructor(filename: string, options: SqliteDatabaseOptions = {}) {
    this.native = new DatabaseSync(filename, {
      readOnly: options.readonly ?? false,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: 5_000,
      allowBareNamedParameters: true,
      // Repository mappers intentionally return complete entity rows while
      // individual statements bind only their explicit named columns.
      allowUnknownNamedParameters: true,
      defensive: true,
    })
  }

  get open(): boolean {
    return this.native.isOpen
  }

  exec(sql: string): this {
    this.native.exec(sql)
    return this
  }

  prepare(sql: string): Statement {
    return new Statement(this.native.prepare(sql))
  }

  pragma(sql: string, options?: { simple?: boolean }): unknown {
    const statement = sql.trim().toLowerCase().startsWith("pragma") ? sql.trim() : `PRAGMA ${sql.trim()}`
    if (/^pragma\s+[a-z_]+\s*=/.test(statement.toLowerCase())) {
      this.native.exec(statement)
      return undefined
    }
    const rows = this.native.prepare(statement).all()
    if (!options?.simple) return rows
    const row = rows[0]
    return row ? Object.values(row)[0] : undefined
  }

  transaction<T>(operation: () => T): () => T {
    return () => {
      const nested = this.native.isTransaction
      const savepoint = `armory_nested_${++this.savepointCounter}`
      this.native.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE")
      try {
        const result = operation()
        this.native.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT")
        return result
      } catch (error) {
        if (nested) {
          this.native.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          this.native.exec(`RELEASE SAVEPOINT ${savepoint}`)
        } else {
          this.native.exec("ROLLBACK")
        }
        throw error
      }
    }
  }

  close(): void {
    if (this.native.isOpen) this.native.close()
  }
}

export default Database

// Preserve the historical better-sqlite3 type spelling while the application
// uses the built-in node:sqlite implementation behind this compatibility layer.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Database {
  export type Database = import("./sqlite-adapter.js").Database
}
