t ts = require('typescript');
const path = require('path');

// 引数から検索したい関数名（シンボル名）を受け取る
// const targetSymbolName = process.argv[2];
// if (!targetSymbolName) {
//   console.error("Usage: node find-refs.js <SymbolName>");
//     process.exit(1);
//     }
//
//     // tsconfig.jsonを読み込んでプロジェクト全体を解析
//     const configPath = ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
//     if (!configPath) {
//       console.error("tsconfig.jsonが見つかりませんでした。");
//         process.exit(1);
//         }
//
//         const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
//         const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
//
//         const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
//         const checker = program.getTypeChecker();
//
//         let foundCount = 0;
//
//         // 全てのソースファイルを走査
//         for (const sourceFile of program.getSourceFiles()) {
//           if (sourceFile.isDeclarationFile) continue; // 型定義ファイルは除外
//
//             function findNodes(node: ts.Node) {
//                 // 識別子（変数名や関数名など）に一致するかチェック
//                     if (ts.isIdentifier(node) && node.text === targetSymbolName) {
//                           const symbol = checker.getSymbolAtLocation(node);
//                                 if (symbol) {
//                                         // 定義元ではなく参照（または定義そのもの）の位置を取得
//                                                 const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
//                                                         console.log(`[発見] ${sourceFile.fileName}:${line + 1}:${character + 1}`);
//                                                                 foundCount++;
//                                                                       }
//                                                                           }
//                                                                               ts.forEachChild(node, findNodes);
//                                                                                 }
//
//                                                                                   findNodes(sourceFile);
//                                                                                   }
//
//                                                                                   console.log(`\n検索完了: ${foundCount}件の箇所が見つかりました（シンボル: ${targetSymbolName}）。`);
//
///
const ts = require('typescript');
const path = require('path');

// å¼•æ•°ã‹ã‚‰æ¤œç´¢ã—ãŸã„é–¢æ•°åï¼^ã‚·ãƒ³ãƒœãƒ«åï¼‰ã‚’å—ã‘å–ã‚‹
// const targetSymbolName = process.argv[2];
// if (!targetSymbolName) {
//   console.error("Usage: node find-refs.js <SymbolName>");
//     process.exit(1);
//     }
//
//     // tsconfig.jsonã‚’èª­ã¿è¾¼ã‚“ã§ãƒ—ãƒ­ã‚¸ã‚§ã‚¯ãƒ^å…¨ä½“ã‚’è§£æž
//     const configPath = ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
//     if (!configPath) {
//       console.error("tsconfig.jsonãŒè¦‹ã¤ã‹ã‚Šã¾ã›ã‚“ã§ã—ãŸã€‚");
//         process.exit(1);
//         }
//
//         const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
//         const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
//
//         const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
//         const checker = program.getTypeChecker();
//
//         let foundCount = 0;
//
//         // å…¨ã¦ã®ã‚½ãƒ¼ã‚¹ãƒ•ã‚¡ã‚¤ãƒ«ã‚’èµ°æŸ»
//         for (const sourceFile of program.getSourceFiles()) {
//           if (sourceFile.isDeclarationFile) continue; // åž‹å®šç¾©ãƒ•ã‚¡ã‚¤ãƒ«ã¯é™¤å¤–
//
//             function findNodes(node: ts.Node) {
//                 // è­~å^¥å­ï¼^å¤‰æ•°åã‚„é–¢æ•°åãªã©ï¼‰ã«ä¸€è‡´ã™ã‚‹ã‹ãƒã‚§ãƒƒã‚¯
//                     if (ts.isIdentifier(node) && node.text === targetSymbolName) {
//                           const symbol = checker.getSymbolAtLocation(node);
//                                 if (symbol) {
//                                         // å®šç¾©å…ƒã§ã¯ãªãå‚ç…§ï¼^ã¾ãŸã¯å®šç¾©ãã®ã‚‚ã®ï¼‰ã®ä½ç½®ã‚’å–å¾—
//                                                 const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
//                                                         console.log(`[ç™ºè¦‹] ${sourceFile.fileName}:${line + 1}:${character + 1}`);
//                                                                 foundCount++;
//                                                                       }
//                                                                           }
//                                                                               ts.forEachChild(node, findNodes);
//                                                                                 }
//
//                                                                                   findNodes(sourceFile);
//                                                                                   }
//
//                                                                                   console.log(`\næ¤œç´¢å®Œäº†: ${foundCount}ä»¶ã®ç®‡æ‰€ãŒè¦‹ã¤ã‹ã‚Šã¾ã—ãŸï¼^ã‚·ãƒ³ãƒœãƒ«: ${targetSymbolName}ï¼‰ã€‚`);const ts = require('typescript');
//                                                                                   const path = require('path');
//
//                                                                                   // å¼•æ•°ã‹ã‚‰æ¤œç´¢ã—ãŸã„é–¢æ•°åï¼^ã‚·ãƒ³ãƒœãƒ«åï¼‰ã‚’å—ã‘å–ã‚‹
//                                                                                   const targetSymbolName = process.argv[2];
//                                                                                   if (!targetSymbolName) {
//                                                                                     console.error("Usage: node find-refs.js <SymbolName>");
//                                                                                       process.exit(1);
//                                                                                       }
//
//                                                                                       // tsconfig.jsonã‚’èª­ã¿è¾¼ã‚“ã§ãƒ—ãƒ­ã‚¸ã‚§ã‚¯ãƒ^å…¨ä½“ã‚’è§£æž
//                                                                                       const configPath = ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
//                                                                                       if (!configPath) {
//                                                                                         console.error("tsconfig.jsonãŒè¦‹ã¤ã‹ã‚Šã¾ã›ã‚“ã§ã—ãŸã€‚");
//                                                                                           process.exit(1);
//                                                                                           }
//
//                                                                                           const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
//                                                                                           const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
//
//                                                                                           const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
//                                                                                           const checker = program.getTypeChecker();
//
//                                                                                           let foundCount = 0;
//
//                                                                                           // å…¨ã¦ã®ã‚½ãƒ¼ã‚¹ãƒ•ã‚¡ã‚¤ãƒ«ã‚’èµ°æŸ»
//                                                                                           for (const sourceFile of program.getSourceFiles()) {
//                                                                                             if (sourceFile.isDeclarationFile) continue; // åž‹å®šç¾©ãƒ•ã‚¡ã‚¤ãƒ«ã¯é™¤å¤–
//
//                                                                                               function findNodes(node: ts.Node) {
//                                                                                                   // è­~å^¥å­ï¼^å¤‰æ•°åã‚„é–¢æ•°åãªã©ï¼‰ã«ä¸€è‡´ã™ã‚‹ã‹ãƒã‚§ãƒƒã‚¯
//                                                                                                       if (ts.isIdentifier(node) && node.text === targetSymbolName) {
//                                                                                                             const symbol = checker.getSymbolAtLocation(node);
//                                                                                                                   if (symbol) {
//                                                                                                                           // å®šç¾©å…ƒã§ã¯ãªãå‚ç…§ï¼^ã¾ãŸã¯å®šç¾©ãã®ã‚‚ã®ï¼‰ã®ä½ç½®ã‚’å–å¾—
//                                                                                                                                   const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
//                                                                                                                                           console.log(`[ç™ºè¦‹] ${sourceFile.fileName}:${line + 1}:${character + 1}`);
//                                                                                                                                                   foundCount++;
//                                                                                                                                                         }
//                                                                                                                                                             }
//                                                                                                                                                                 ts.forEachChild(node, findNodes);
//                                                                                                                                                                   }
//
//                                                                                                                                                                     findNodes(sourceFile);
//                                                                                                                                                                     }
//
//                                                                                                                                                                     console.log(`\næ¤œç´¢å®Œäº†: ${foundCount}ä»¶ã®ç®‡æ‰€ãŒè¦‹ã¤ã‹ã‚Šã¾ã—ãŸï¼^ã‚·ãƒ³ãƒœãƒ«: ${targetSymbolName}ï¼‰ã€‚`);
//


