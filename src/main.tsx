
import "./index.css";
import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { Spinner } from "@/components/ui/spinner"
import { AppRoot } from "./app-root"


const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element not found")
}

const root = createRoot(rootElement)

function RendererFailure({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-lg rounded-xl border border-destructive/30 bg-card p-6 shadow-lg">
        <h1 className="text-lg font-semibold text-destructive">Application failed to start</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <p className="mt-4 text-xs text-muted-foreground">Correct the configuration, then restart the application.</p>
      </div>
    </div>
  )
}

class ApplicationErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Application render failed", error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) return <RendererFailure error={this.state.error} />
    return this.props.children
  }
}

performance.mark("boot:renderer-module:start")
console.info("[perf] main.tsx module start")

function BootShell() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at top, rgba(17,24,39,0.05), transparent 35%), #ffffff",
        color: "#111827",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          textAlign: "center",
          padding: "24px 28px",
          borderRadius: 20,
          border: "1px solid rgba(17,24,39,0.08)",
          background: "rgba(255,255,255,0.92)",
          boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
          backdropFilter: "blur(8px)",
        }}
      >
        <Spinner className="size-8" />
        <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>Loading application…</div>
        <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>Preparing the interface</div>
      </div>
    </div>
  )
}

performance.mark("boot:renderer-shell:render-start")
root.render(<BootShell />)
performance.mark("boot:renderer-shell:render-end")
performance.measure("boot:renderer-shell", "boot:renderer-shell:render-start", "boot:renderer-shell:render-end")
console.info("[perf] main.tsx shell rendered")

performance.mark("boot:renderer:app-root:render-start")
root.render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <AppRoot />
    </ApplicationErrorBoundary>
  </StrictMode>
)
performance.mark("boot:renderer:app-root:rendered")
performance.measure("boot:renderer:app-root", "boot:renderer-shell:render-end", "boot:renderer:app-root:rendered")



