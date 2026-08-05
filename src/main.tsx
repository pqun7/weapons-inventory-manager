import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Spinner } from "@/components/ui/spinner"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element not found")
}

const root = createRoot(rootElement)

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

setTimeout(() => {
  performance.mark("boot:renderer:after-shell-delay")
  performance.mark("boot:renderer:app-root:import-start")
  void import("./app-root.tsx").then(({ AppRoot }) => {
    performance.mark("boot:renderer:app-root:import-end")
    performance.measure("boot:renderer:app-root-import", "boot:renderer:app-root:import-start", "boot:renderer:app-root:import-end")
    performance.mark("boot:renderer:app-root:imported")
    root.render(
      <StrictMode>
        <AppRoot />
      </StrictMode>
    )
    performance.mark("boot:renderer:app-root:rendered")
    performance.measure("boot:renderer:app-root", "boot:renderer:after-shell-delay", "boot:renderer:app-root:rendered")
  }).catch((error) => {
    console.error("Failed to load application shell:", error)
  })
}, 0)



