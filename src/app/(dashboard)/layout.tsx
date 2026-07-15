import DashboardNav from "@/components/dashboard/DashboardNav";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0f14] text-white md:flex-row">
      <DashboardNav />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
