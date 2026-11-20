import { expect, test } from "playwright/test";

const reopenedDecision = "A案を採用します";

test("reopened automatic decision stays unconfirmed in Canonical, dashboard, archive and exports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /入力・再生/ }).click();
  await page.getByRole("textbox", { name: "手動発話" }).fill(reopenedDecision);
  await page.getByRole("button", { name: "手動発話を投入" }).click();
  await page.getByRole("button", { name: "会議を終了して議事録を確認" }).click();

  await page.getByRole("button", { name: "確定", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(reopenedDecision) }).click();
  await page.getByRole("button", { name: "確定を取り消す" }).click();
  await page.getByRole("button", { name: "要確認", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(reopenedDecision) })).toContainText("要確認");

  await page.getByRole("button", { name: "この端末に保存" }).click();
  await expect(page.getByText("この端末に保存済み")).toBeVisible();

  const archiveBeforeReload = await page.evaluate(async () => {
    const request = indexedDB.open("speak-attension-meetings");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const archives = await new Promise<any[]>((resolve, reject) => {
      const getAll = database.transaction("archives", "readonly").objectStore("archives").getAll();
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
    database.close();
    const archive = archives[0];
    if (!archive) throw new Error("saved archive not found");
    return { id: archive.id, actions: archive.events
      .filter((event) => event.kind === "item_review")
      .map((event) => event.event.action) };
  });
  expect(archiveBeforeReload.actions).toContain("ItemReviewReopened");

  await page.reload();
  await page.getByText("保存済み会議を開く", { exact: true }).click();
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(reopenedDecision) })).toContainText("要確認");

  if (new URL(page.url()).hostname === "127.0.0.1") {
  const canonicalProjection = await page.evaluate(async ({ archiveId, title }) => {
    const importAppModule = (path: string) => import(/* @vite-ignore */ path);
    const [{ IndexedDbMeetingArchiveStorage }, { projectMeetingArchive }, { projectMeetingMinutes },
      { projectMeetingState }, { applyReviewStateToMeetingGraph, meetingStateGraphFromProjection }] = await Promise.all([
      importAppModule("/src/semantic/meetingArchiveStorage.ts"),
      importAppModule("/src/semantic/meetingArchive.ts"),
      importAppModule("/src/semantic/meetingMinutesProjection.ts"),
      importAppModule("/src/semantic/meetingStateProjection.ts"),
      importAppModule("/src/semantic/meetingStateGraph.ts"),
    ]);
    const storage = new IndexedDbMeetingArchiveStorage();
    const loaded = await storage.load(archiveId);
    if (!loaded.ok || !loaded.value) throw new Error("archive missing after reload");
    const archive = loaded.value;
    const projection = projectMeetingArchive(archive);
    const minutes = projectMeetingMinutes(archive.id, projection.canonical, {
      events: archive.events,
      policyVersion: archive.policyVersion,
      nextSeq: Math.max(0, ...archive.events.flatMap((event) =>
        event.kind === "utterance_added" ? [event.utterance.seq] : [])) + 1,
    });
    const timestamps = new Map(archive.events.flatMap((event) =>
      event.kind === "utterance_added" ? [[event.utterance.id, event.utterance.createdAt]] : []));
    const graph = applyReviewStateToMeetingGraph(
      meetingStateGraphFromProjection(projectMeetingState(projection.canonical), (id) => timestamps.get(id) ?? 0),
      minutes.items,
    );
    const decision = graph.nodes.find((node) => node.label === title);
    const item = minutes.items.find((candidate) => candidate.title === title);
    return { graphState: decision?.state ?? null, reviewState: item?.reviewState ?? null };
  }, { archiveId: archiveBeforeReload.id, title: reopenedDecision });
  expect(canonicalProjection).toEqual({ graphState: "unconfirmed", reviewState: "pending" });
  }

  await page.getByText("議事録プレビュー", { exact: true }).click();
  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 出力" }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = await jsonDownload.path();
  if (!jsonPath) throw new Error("JSON export was not saved");
  const { readFile } = await import("node:fs/promises");
  const exported = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(exported.pending).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: reopenedDecision, reviewState: "pending" }),
  ]));
  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown 出力" }).click();
  const markdownDownload = await markdownDownloadPromise;
  const markdownPath = await markdownDownload.path();
  if (!markdownPath) throw new Error("Markdown export was not saved");
  expect(await readFile(markdownPath, "utf8")).toContain("要確認");

  await page.getByRole("button", { name: "会議を再開" }).click();
  const dashboard = page.getByRole("region", { name: "会議の状況" });
  await expect(dashboard.getByRole("heading", { name: "未確認・未解決" })).toBeVisible();
  await expect(dashboard.locator(".gap-list.is-unresolved").filter({ hasText: reopenedDecision }).first()).toBeVisible();
  await expect(dashboard.locator(".decision-cards")).toHaveCount(0);
});
