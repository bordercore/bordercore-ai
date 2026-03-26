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

  return (
    <div id="audioPlayer" style={{ display: audioIsPlayingOrPaused ? "flex" : "none" }}>
      <div
        id="audioPlayerInfo"
        className="relative flex items-center justify-center w-full"
      >
        {audioIsPlayingOrPaused && (
          <div className="flex">
            <img
              id="isPlaying"
              src="/static/img/equaliser-animated-green.gif"
              className="mb-1 mr-2"
              width="20"
              height="20"
            />
            {musicInfo ? (
              <div>
                Playing{" "}
                <span className="text-bs-info">{currentSong.title}</span> by{" "}
                <span className="text-bs-info">{currentSong.artist}</span>
                <div id="songIndex">
                  <span
                    className={`mr-3 ${songIndex > 0 ? "text-bs-info" : "text-bs-secondary"}`}
                  >
                    <FontAwesomeIcon
                      icon={faBackward}
                      className="glow"
                      onClick={onSongBackward}
                    />
                  </span>
                  <span className="font-bold">{songIndex + 1}</span> /{" "}
                  <span className="font-bold">{musicInfo.length}</span>
                  <span
                    className={`ml-3 ${songIndex < musicInfo.length - 1 ? "text-bs-info" : "text-bs-secondary"}`}
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
