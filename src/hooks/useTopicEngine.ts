import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionLogEntry, TopicGraphEdge, TopicGraphNode, TranscriptSegment } from "../types/topic";
import {
  INITIAL_TOPIC_EDGES,
  INITIAL_TOPIC_NODES,
  buildUnknownTopicLabel,
  createId,
  scoreTopic,
} from "../utils/topicRules";

const HEAT_INCREMENT = 0.25;
const HEAT_DECAY = 0.01;
const SEGMENT_INTERVAL_MS = 5000;
const UNKNOWN_MIN_LENGTH = 20;
const UNKNOWN_DUPLICATE_WINDOW_MS = 60_000;

type UseTopicEngineOptions = {
  onLog?: (entry: SessionLogEntry) => void;
};

function cloneInitialNodes(): TopicGraphNode[] {
  return INITIAL_TOPIC_NODES.map((node) => ({
    ...node,
    position: { ...node.position },
    data: {
      ...node.data,
      keywords: [...node.data.keywords],
      evidence: [],
    },
  }));
}

function cloneInitialEdges(): TopicGraphEdge[] {
  return INITIAL_TOPIC_EDGES.map((edge) => ({ ...edge }));
}

function limitEvidence(evidence: string[], nextText: string): string[] {
  return [nextText, ...evidence.filter((item) => item !== nextText)].slice(0, 5);
}

function findUnknownDuplicate(nodes: TopicGraphNode[], text: string, now: number): TopicGraphNode | null {
  const label = buildUnknownTopicLabel(text);
  const prefix = label.slice(0, 12);
  return (
    nodes.find((node) => {
      if (!node.id.startsWith("custom-")) return false;
      if (!node.data.lastTouchedAt || now - node.data.lastTouchedAt > UNKNOWN_DUPLICATE_WINDOW_MS) return false;
      return node.data.label.slice(0, 12) === prefix;
    }) ?? null
  );
}

function nextCustomPosition(nodes: TopicGraphNode[]) {
  const customCount = nodes.filter((node) => node.id.startsWith("custom-")).length;
  return {
    x: 900,
    y: 220 + customCount * 112,
  };
}

export function useTopicEngine({ onLog }: UseTopicEngineOptions = {}) {
  const [nodes, setNodes] = useState<TopicGraphNode[]>(() => cloneInitialNodes());
  const [edges, setEdges] = useState<TopicGraphEdge[]>(() => cloneInitialEdges());
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [currentTopicId, setCurrentTopicId] = useState<string | null>(null);
  const [bufferText, setBufferText] = useState("");
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const bufferRef = useRef("");

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const addLog = useCallback(
    (entry: Omit<SessionLogEntry, "id" | "at"> & { at?: number }) => {
      const nextEntry: SessionLogEntry = {
        id: createId("log"),
        at: entry.at ?? Date.now(),
        type: entry.type,
        message: entry.message,
        payload: entry.payload,
      };
      setLogs((current) => [nextEntry, ...current].slice(0, 80));
      onLog?.(nextEntry);
    },
    [onLog],
  );

  const processSegment = useCallback(
    (text: string) => {
      const now = Date.now();
      const baseNodes = nodesRef.current;
      const topicScores = baseNodes
        .map((node, index) => ({ id: node.id, index, score: scoreTopic(text, node) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index);

      const matchedTopicIds = topicScores.map((item) => item.id);
      let activeTopicId = topicScores[0]?.id ?? null;
      let nextNodes = baseNodes;
      let nextEdges = edgesRef.current;

      if (matchedTopicIds.length > 0) {
        nextNodes = baseNodes.map((node) => {
          if (!matchedTopicIds.includes(node.id)) return node;
          return {
            ...node,
            data: {
              ...node.data,
              heat: Math.min(1, Number((node.data.heat + HEAT_INCREMENT).toFixed(2))),
              lastTouchedAt: now,
              evidence: limitEvidence(node.data.evidence, text),
            },
          };
        });
      } else if (text.length >= UNKNOWN_MIN_LENGTH) {
        const duplicate = findUnknownDuplicate(baseNodes, text, now);
        if (duplicate) {
          activeTopicId = duplicate.id;
          matchedTopicIds.push(duplicate.id);
          nextNodes = baseNodes.map((node) => {
            if (node.id !== duplicate.id) return node;
            return {
              ...node,
              data: {
                ...node.data,
                heat: Math.min(1, Number((node.data.heat + HEAT_INCREMENT).toFixed(2))),
                lastTouchedAt: now,
                evidence: limitEvidence(node.data.evidence, text),
              },
            };
          });
        } else {
          const id = createId("custom");
          activeTopicId = id;
          matchedTopicIds.push(id);
          const label = buildUnknownTopicLabel(text);
          const customNode: TopicGraphNode = {
            id,
            type: "topic",
            position: nextCustomPosition(baseNodes),
            data: {
              label,
              heat: HEAT_INCREMENT,
              keywords: [label, label.slice(0, 8)].filter(Boolean),
              lastTouchedAt: now,
              evidence: [text],
            },
          };
          nextNodes = [...baseNodes, customNode];
          nextEdges = [
            ...edgesRef.current,
            {
              id: `topic-${id}`,
              source: currentTopicId ?? "topic-detection",
              target: id,
            },
          ];
        }
      }

      const segment: TranscriptSegment = {
        id: createId("seg"),
        text,
        createdAt: now,
        matchedTopicIds,
      };

      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setCurrentTopicId(activeTopicId);
      setSegments((current) => [segment, ...current].slice(0, 60));
      addLog({
        type: "segment",
        message: activeTopicId ? `segment matched ${activeTopicId}` : "segment had no topic match",
        payload: segment,
        at: now,
      });
    },
    [addLog, currentTopicId],
  );

  const flushBuffer = useCallback(() => {
    const text = bufferRef.current.replace(/\s+/g, " ").trim();
    if (!text) return;
    bufferRef.current = "";
    setBufferText("");
    processSegment(text);
  }, [processSegment]);

  const addTranscriptText = useCallback(
    (text: string) => {
      const cleanText = text.replace(/\s+/g, " ").trim();
      if (!cleanText) return;
      bufferRef.current = [bufferRef.current, cleanText].filter(Boolean).join(" ");
      setBufferText(bufferRef.current);
      addLog({
        type: "speech",
        message: "speech chunk received",
        payload: { text: cleanText },
      });
    },
    [addLog],
  );

  const reset = useCallback(() => {
    const initialNodes = cloneInitialNodes();
    const initialEdges = cloneInitialEdges();
    nodesRef.current = initialNodes;
    edgesRef.current = initialEdges;
    bufferRef.current = "";
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSegments([]);
    setCurrentTopicId(null);
    setBufferText("");
    setLogs([]);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(flushBuffer, SEGMENT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [flushBuffer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNodes((current) => {
        const next = current.map((node) => ({
          ...node,
          data: {
            ...node.data,
            heat: Math.max(0, Number((node.data.heat - HEAT_DECAY).toFixed(2))),
          },
        }));
        nodesRef.current = next;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentTopic = useMemo(
    () => nodes.find((node) => node.id === currentTopicId) ?? null,
    [currentTopicId, nodes],
  );

  const heatLeaders = useMemo(
    () => [...nodes].sort((a, b) => b.data.heat - a.data.heat).slice(0, 6),
    [nodes],
  );

  return {
    addLog,
    addTranscriptText,
    bufferText,
    currentTopic,
    currentTopicId,
    edges,
    flushBuffer,
    heatLeaders,
    logs,
    nodes,
    reset,
    segments,
  };
}
