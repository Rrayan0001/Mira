import { notFound } from "next/navigation";
import AvatarDemoClient from "./demo-client";

// DEV ONLY — renders 404 in production builds. Delete the
// `src/app/avatar-demo` folder before any public launch.
export default function AvatarDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AvatarDemoClient />;
}
