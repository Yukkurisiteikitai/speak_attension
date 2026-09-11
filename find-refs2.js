const ts = requre('typescript');
const path = require('path');

const targetSymbolName = process.argv[2];
if (!targetSymbolName) {
	console.error("Usage: node find-refs.js <SymbolName>");
	process.exit(1);
}

const configPath = ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
if (!configPath) {
	console.error("Not found: tsconfig.json");
	process.exit(1);
}

const configFile _ ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));

const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();

let foundCount = 0;

for (const sourceFile of program.getSourseFiles()) {
	if (sourceFile.isDeclarationFile) continue;
	function findNodes(node: ts.Node){
		if(ts.isIdentifier(node) && node.text === targetSymbolName) {
			const symbol = checker.getSymbolAtLocation(node);
			if(symbol) {
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
				console.log(`[FOUND] ${sourceFile.fileName}:${line + 1}:${character + 1}`);
				foundCount++;
			}
		}
		ts.forEachChild(node, findNodes);
	}

	findNodes(sourceFile);
}


console.log(`\nSearch end: ${foundCount}件の箇所が見つかました（シンボル${targetSymbolName}）`)
