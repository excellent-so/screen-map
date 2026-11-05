// Fixture: a dynamic-[param] wizard gated by app state (like an onboarding flow).
// The step allow-list lives in source; the route redirects unless ?preview=1 —
// so state-sweep must discover the steps AND force them through the preview seam.
import { notFound, redirect } from "next/navigation";

type WizardStep = "intro" | "details" | "review" | "done";
const VALID_STEPS: WizardStep[] = ["intro", "details", "review", "done"];

export default async function Wizard({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { step } = await params;
  const { preview } = await searchParams;
  if (!VALID_STEPS.includes(step)) notFound();
  if (!preview) redirect("/"); // gated: real users are bounced unless a step is active
  return <main>Wizard step: {step}</main>;
}
