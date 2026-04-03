"use client";

import dynamic from "next/dynamic";

const LearningSidebar = dynamic(
  () => import("@/components/home/LearningSidebar").then((m) => m.LearningSidebar),
  { ssr: false },
);

export function LearningSidebarClientOnly() {
  return <LearningSidebar />;
}

