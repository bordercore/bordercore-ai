import React, { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBackward, faForward } from "@fortawesome/free-solid-svg-icons";
import { animateCSS } from "../utils/animateCSS";

interface AudioPlayerProps {
  audioIsPlayingOrPaused: boolean;
  musicInfo: any[] | null;
  currentSong: any;
  uploadedFilename: string | null;
  onSongBackward: (event: React.MouseEvent) => void;
  onSongForward: (event: React.MouseEvent) => void;
}

export default function AudioPlayer({
  audioIsPlayingOrPaused,
  musicInfo,
  currentSong,
  uploadedFilename,
  onSongBackward,
  onSongForward,
}: AudioPlayerProps) {
  const songIndex = useMemo(() => {
    if (!musicInfo) return -1;
    return musicInfo.findIndex((x) => x === currentSong);
  }, [musicInfo, currentSong]);

  const isVisible = audioIsPlayingOrPaused;

  return (
    <div id="audioPlayer" className={isVisible ? "d-flex" : "d-none"}>
      <div
        id="audioPlayerInfo"
        className="position-relative d-flex align-items-center justify-content-center w-100"
      >
        {audioIsPlayingOrPaused && (
          <div className="d-flex">
            <img
              id="isPlaying"
              src="/static/img/equaliser-animated-green.gif"
              className="mb-1 me-2"
              width="20"
              height="20"
            />
            {musicInfo ? (
              <div>
                Playing{" "}
                <span className="text-info">{currentSong.title}</span> by{" "}
                <span className="text-info">{currentSong.artist}</span>
                <div id="songIndex">
                  <span
                    className={`me-3 ${songIndex > 0 ? "text-info" : "text-secondary"}`}
                  >
                    <FontAwesomeIcon
                      icon={faBackward}
                      className="glow"
                      onClick={onSongBackward}
                    />
                  </span>
                  <span className="fw-bold">{songIndex + 1}</span> /{" "}
                  <span className="fw-bold">{musicInfo.length}</span>
                  <span
                    className={`ms-3 ${songIndex < musicInfo.length - 1 ? "text-info" : "text-secondary"}`}
                  >
                    <FontAwesomeIcon
                      icon={faForward}
                      className="glow"
                      onClick={onSongForward}
                    />
                  </span>
                </div>
              </div>
            ) : (
              <div>Playing {uploadedFilename}</div>
            )}
          </div>
        )}
      </div>
      <media-controller audio>
        <audio id="player" slot="media" src="" type="audio/mpeg"></audio>
        <media-control-bar className="media-control-bar">
          <media-play-button id="media-play-button"></media-play-button>
          <media-time-display showduration></media-time-display>
          <media-time-range></media-time-range>
          <media-mute-button></media-mute-button>
          <media-volume-range></media-volume-range>
        </media-control-bar>
      </media-controller>
    </div>
  );
}

// Declare web component types for TypeScript
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "media-controller": any;
      "media-control-bar": any;
      "media-play-button": any;
      "media-time-display": any;
      "media-time-range": any;
      "media-mute-button": any;
      "media-volume-range": any;
    }
  }
}
