import React from "react";

type SkeletonLoaderProps = {
  variant?: "text" | "circle" | "rect" | "card";
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
};

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = "text",
  width = "100%",
  height = "1em",
  count = 1,
  className = ""
}) => {
  const baseClassName = `skeleton skeleton--${variant} ${className}`;

  if (variant === "card") {
    return (
      <div className={baseClassName} style={{ width, height }}>
        <div className="skeleton__header" />
        <div className="skeleton__content">
          <div className="skeleton__line" />
          <div className="skeleton__line skeleton__line--short" />
          <div className="skeleton__line" />
        </div>
      </div>
    );
  }

  if (variant === "circle") {
    return (
      <div
        className={baseClassName}
        style={{
          width: typeof width === "number" ? `${width}px` : width,
          height: typeof height === "number" ? `${height}px` : height,
          borderRadius: "50%"
        }}
      />
    );
  }

  if (variant === "rect") {
    return (
      <div
        className={baseClassName}
        style={{
          width: typeof width === "number" ? `${width}px` : width,
          height: typeof height === "number" ? `${height}px` : height,
          borderRadius: "var(--radius-md)"
        }}
      />
    );
  }

  // Variant: text
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={baseClassName}
          style={{
            width: index === count - 1 ? "80%" : width,
            height: typeof height === "number" ? `${height}px` : height,
            marginBottom: index < count - 1 ? "0.5em" : 0
          }}
        />
      ))}
    </>
  );
};

export default SkeletonLoader;

