const { runStructuredAnalysis } = require("./openaiStructuredClient");

async function main() {
  const apiKey = process.argv[2];
  if (!apiKey) {
    throw new Error("Pass API key as first argument: node example.js <OPENAI_API_KEY>");
  }

  const result = await runStructuredAnalysis({
    apiKey,
    prompt: "Analyze sales and identify trend, risks, and next step.",
    data: {
      period: "Q1",
      sales: [120, 140, 130],
      returns: [3, 5, 8],
    },
  });

  console.log("TEXT:\n", result.text);
  console.log("\nTABLE:\n", result.table);
  console.log("\nSUMMARY:\n", result.summary);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
