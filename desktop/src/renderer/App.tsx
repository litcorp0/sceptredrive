export function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border p-8">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          GikAutos POS
        </p>
        <h1 className="mt-2 text-2xl font-semibold" data-testid="shell-ready">
          Desktop shell ready
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Electron Forge 8 + Vite 8 + React 19. Hardening, the keychain bridge, and the PowerSync
          spike land next.
        </p>
      </section>
    </main>
  )
}
