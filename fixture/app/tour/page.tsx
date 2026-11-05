// Fixture: a static route hiding a MULTI-AXIS client state machine behind query
// params (like a product tour). One route, three axes: a string-union `mode`
// discriminator + two numeric axes (`slide`, `step`) indexing source arrays. The
// page honors its own params, so NO preview seam is needed.
import { Tour } from "./_tour";

export default async function TourPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; slide?: string; step?: string }>;
}) {
  const { mode, slide, step } = await searchParams;
  return <Tour initialMode={mode} initialSlide={slide} initialStep={step} />;
}
