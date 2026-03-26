import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPaperclip,
  faFileAlt,
  faLink,
  faCheck,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import { formatBytes } from "../utils/formatBytes";

interface FileUploadProps {
  mode: string;
  url: string;
  uploadedFilename: string | null;
  audioFileTranscript: string | null;
  audioFileSize: number | null;
  ragFileUploaded: boolean;
  ragFileSize: number | null;
  visionImage: File | null;
  copyIcon: string;
  onTranscribeAudio: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFileUploadVision: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCopyText: () => void;
}

export default function FileUpload({
  mode,
  url,
  uploadedFilename,
  audioFileTranscript,
  audioFileSize,
  ragFileUploaded,
  ragFileSize,
  visionImage,
  copyIcon,
  onTranscribeAudio,
  onFileUploadVision,
  onFileUpload,
  onCopyText,
}: FileUploadProps) {
  return (
    <>
      {mode === "Audio" && !url && (
        <div className="file-input-wrapper">
          <FontAwesomeIcon icon={faPaperclip} className="fa-lg text-bs-primary ml-3 mr-1" />
          {" "}Add audio file
          <input type="file" className="file-input" onChange={onTranscribeAudio} />
        </div>
      )}

      {mode === "Audio" && audioFileTranscript && (
        <div className="flex items-center">
          <div>
            <FontAwesomeIcon icon={faFileAlt} className="fa-lg text-bs-primary ml-3" />
          </div>
          <div className="file-name ml-2">{uploadedFilename}</div>
          <div className="ml-2">{"\u2022"}</div>
          <div className="ml-2">{formatBytes(audioFileSize || 0)}</div>
        </div>
      )}

      {mode === "Vision" && (
        <div className="flex items-center mb-3">
          <div className="file-input-wrapper">
            <FontAwesomeIcon icon={faPaperclip} className="fa-lg text-bs-primary ml-3 mr-1" />
            {" "}Add image
            <input
              type="file"
              name="image"
              className="file-input"
              accept=".jpg,.jpeg,.png,.gif"
              onChange={onFileUploadVision}
            />
          </div>
          {visionImage && (
            <div className="flex items-center">
              <div>
                <FontAwesomeIcon icon={faFileAlt} className="fa-lg text-bs-primary ml-3" />
              </div>
              <div className="file-name ml-2">{visionImage.name}</div>
              <div className="ml-2">{"\u2022"}</div>
              <div className="ml-2">{formatBytes(visionImage.size)}</div>
            </div>
          )}
        </div>
      )}

      {mode === "RAG" && (
        <div className="flex items-center mb-3">
          <div className="file-input-wrapper">
            <FontAwesomeIcon icon={faPaperclip} className="fa-lg text-bs-primary ml-3 mr-1" />
            {" "}Add content
            <input type="file" className="file-input" onChange={onFileUpload} />
          </div>
          {ragFileUploaded && (
            <div className="flex items-center">
              <div>
                <FontAwesomeIcon icon={faFileAlt} className="fa-lg text-bs-primary ml-3" />
              </div>
              <div className="file-name ml-2">{uploadedFilename}</div>
              <div className="ml-2">{"\u2022"}</div>
              <div className="ml-2">{formatBytes(ragFileSize || 0)}</div>
            </div>
          )}
        </div>
      )}

      {url && !audioFileTranscript && (
        <div className="flex items-center">
          <div>
            <FontAwesomeIcon icon={faLink} className="fa-lg text-bs-primary ml-3" />
          </div>
          <div className="text-bs-info ml-2">{url}</div>
        </div>
      )}

      {mode === "Audio" && audioFileTranscript && (
        <div className="transcript-container">
          <div id="transcript" className="relative">
            <div
              id="copyIcon"
              className="hover-target hidden"
              onClick={onCopyText}
            >
              <FontAwesomeIcon
                icon={copyIcon === "check" ? faCheck : faCopy}
                className="fa-lg ml-3"
              />
            </div>
            {audioFileTranscript}
          </div>
        </div>
      )}
    </>
  );
}
