import type { DatabaseProvider } from "./database-provider.js"

let activeProvider: DatabaseProvider | null = null

export function configureDatabaseProvider(provider: DatabaseProvider): void {
  if (activeProvider && activeProvider !== provider) {
    throw new Error("Changing the active database provider requires the administrator migration workflow and an application reload")
  }
  activeProvider = provider
}

export function getDatabaseProvider(): DatabaseProvider {
  if (!activeProvider) throw new Error("The database provider has not been configured")
  return activeProvider
}

export function configuredDatabaseProvider(): DatabaseProvider | null {
  return activeProvider
}
