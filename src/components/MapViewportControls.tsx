import { Controls, Panel, useReactFlow } from "@xyflow/react";
import { ScanSearch } from "lucide-react";
import { useCallback, useEffect } from "react";

type MapViewportControlsProps = {
  fitKey: string | number;
  padding?: number;
};

export function MapViewportControls({ fitKey, padding = 0.16 }: MapViewportControlsProps) {
  const { fitView } = useReactFlow();
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
      <Controls showFitView={false} showInteractive={false} aria-label="マップの拡大縮小" />
    </>
  );
}
