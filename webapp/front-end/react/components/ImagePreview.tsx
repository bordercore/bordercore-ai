import React from "react";

interface ImagePreviewProps {
  visionImage: File | null;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  imageSrc: string;
}

export default function ImagePreview({
  visionImage,
  isDragOver,
  onDragOver,
  onDrop,
  onDragEnter,
  onDragLeave,
  imageSrc,
}: ImagePreviewProps) {
  return (
    <div
      id="artifact-container"
      className={`p-2${visionImage === null ? " d-none" : ""}`}
    >
      <img
        id="image-preview"
        className="w-100 p-1"
        src={imageSrc}
        alt="Image preview"
      />
    </div>
  );
}
