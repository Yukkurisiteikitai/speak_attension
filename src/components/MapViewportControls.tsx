import { ControlButton, Controls, Panel, useReactFlow } from "@xyflow/react";
import { Minus, Plus, ScanSearch } from "lucide-react";
import { useCallback, useEffect } from "react";

type MapViewportControlsProps = {
  fitKey: string | number;
  padding?: number;
};

export function MapViewportControls({ fitKey, padding = 0.16 }: MapViewportControlsProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const showEntireMap = useCallback((duration = 300) => {
    void fitView({ duration, padding });
  }, [fitView, padding]);

  useEffect(() => {
    const timer = window.setTimeout(() => showEntireMap(0), 60);
    return () => window.clearTimeout(timer);
  }, [fitKey, showEntireMap]);

  return (
    <>
      <Panel position="bottom-right" className="map-viewport-panel">
        <button type="button" onClick={() => showEntireMap()} aria-label="マップ全体を画面内に表示">
          <ScanSearch size={16} aria-hidden="true" />
          <span>全体を表示</span>
        </button>
      </Panel>
      {/* Custom icons replace the library's default zoom in/out buttons: the
          built-in icons render at 0 width in some flows for reasons not
          fully isolated (see .react-flow__controls-button svg in styles.css
          for the fix these still need). */}
      <Controls showZoom={false} showFitView={false} showInteractive={false} aria-label="マップの拡大縮小">
        <ControlButton onClick={() => void zoomIn()} aria-label="拡大">
          <Plus size={12} aria-hidden="true" />
        </ControlButton>
        <ControlButton onClick={() => void zoomOut()} aria-label="縮小">
          <Minus size={12} aria-hidden="true" />
        </ControlButton>
      </Controls>
    </>
  );
}
