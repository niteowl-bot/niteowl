import { Suspense } from "react";
import ManageBookingClient from "./ManageBookingClient";

export default function ManageBookingPage() {
  return (
    <Suspense fallback={null}>
      <ManageBookingClient />
    </Suspense>
  );
}
