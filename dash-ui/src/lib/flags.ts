export const isUltraSafe = (): boolean => {
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("ultra") === "1" ||
    import.meta.env.VITE_ULTRA_SAFE === "1"
  );
};

export const isStaticMode = (): boolean => {
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("static") === "1" ||
    import.meta.env.VITE_STATIC_OVERLAY === "1"
  );
};

export const isSafeMode = (): boolean => {
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("safe") === "1" ||
    import.meta.env.VITE_SAFE_MODE === "1"
  );
};
