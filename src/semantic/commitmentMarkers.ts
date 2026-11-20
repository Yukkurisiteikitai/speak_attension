// Signals shared by the parser, relation extraction and review policy.
export const scheduleTime = /(?:(?:今週|来週|再来週)?[月火水木金土日]曜(?:日)?|\d{1,2}月\d{1,2}日|明日|明後日)(?:\s|の)*(?:午前|午後)?\s*(?:\d{1,2}時(?:\d{1,2}分|半)?|\d{1,2}[:：]\d{2})/;
export const scheduleIntent = /(?:次回|日程|日時|レビュー|打ち合わせ|会議|定例|開催)/;
export const scheduleAcceptance = /^(?:はい[、,。\s]*)?(?:その(?:時間|日時|日程)で|それで)(?:確定(?:です|します)|決定(?:です|します)|合意します)[。！!\s]*$/;
export const withdrawalMarker = /(?:発言|決定|合意|案|先ほどの件|さっきの件|取り決め)[^。]{0,20}(?:撤回|取り消)[^。]{0,10}(?:します|しました|撤回です)[。\s]*$/;
export const supersessionMarker = /(?:から|ではなく).{1,50}(?:に変更します|に変更しました)[。\s]*$/;
export const conditionMarker = /(?:条件|次第|を見てから|確認してから|場合(?:は|に)|できたら|できれば|完了(?:後|したら)|結果待ち|通れば|ならば|であれば)/;
export const uncertaintyMarker = /(?:たぶん|おそらく|かもしれ|と思(?:う|い|って)|できそう|れそう|未定|検討中|仮決|一応|とりあえず|予定です|とは限ら|まだ決|決定ではな)/;
export const authorityMarker = /(?:予算|支払|契約|発注|稟議|承認|責任者|法務|個人情報|権限|本番|公開|リリース|削除|人事)/;
export const firstPerson = /(?:^|[、。\s])(?:私|わたし|僕|自分)(?:が|は)/;

export function isScheduleMention(text: string): boolean {
  return scheduleTime.test(text) && scheduleIntent.test(text);
}

export function scheduleSubject(text: string): string | undefined {
  return text.match(/^(.{2,40}?)(?:は|を)/)?.[1];
}
