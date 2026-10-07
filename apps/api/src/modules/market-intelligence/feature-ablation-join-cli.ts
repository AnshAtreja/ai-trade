import { joinFrozenSetupsToContext } from "./feature-ablation-join";

void joinFrozenSetupsToContext((completed, total, date) => {
  console.log(JSON.stringify({ event: "phase9d_join_progress", date, completed, total, percent: completed / total * 100 }));
}).then(({ manifest, manifestPath, pointsPath }) => {
  console.log(JSON.stringify({ event: "phase9d_join_complete", manifestPath, pointsPath, joinId: manifest.joinId,
    setupEvaluations: manifest.setupEvaluations, distinctSetups: manifest.distinctSetups,
    requestedContextPoints: manifest.requestedContextPoints, joinedContextPoints: manifest.joinedContextPoints,
    missingContextPoints: manifest.missingContextPoints.length }));
}).catch((error) => {
  console.error(JSON.stringify({ event: "fatal", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
