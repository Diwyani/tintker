import type { Metadata } from "next";
import ColourTool from "./tool";

export const metadata: Metadata = {
  title: "Tintker",
  description: "Find a colour palette in a photo or film still.",
};

export default function Page() {
  return <ColourTool />;
}
