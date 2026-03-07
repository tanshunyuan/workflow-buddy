import { useEffect } from "react";

export function useAutoScroll(element: HTMLDivElement | null, dependency: unknown) {
  useEffect(() => {
    if (!element) return;

    element.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [dependency, element]);
}
