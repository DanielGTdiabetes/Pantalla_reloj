export const isStaticMode = (): boolean => {
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("static") === "1" ||
    import.meta.env.VITE_STATIC_OVERLAY === "1"
  );
};
