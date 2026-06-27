export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4 py-12">
      <a href="/" className="mb-8 text-white font-bold text-2xl tracking-tight">
        niteowl<span className="text-indigo-400">.</span>
      </a>
      {children}
    </div>
  )
}
