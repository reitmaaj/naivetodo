/**
 * Finds the solution that dominates the highest number of others.
 * @param {Array} solutions - Array of objects {t1, t2, t3}
 * @returns {Object} The "best" solution based on dominance count
 */
function getMostDominantSolution(solutions) {
  if (!solutions || solutions.length === 0) return null;

  const dominanceCounts = solutions.map((candidate, i) => {
    let count = 0;
    
    solutions.forEach((target, j) => {
      if (i === j) return; // Don't compare against self

      const betterInAtLeastOne = 
        candidate.t1 < target.t1 || 
        candidate.t2 < target.t2 || 
        candidate.t3 < target.t3;

      const worseInNone = 
        candidate.t1 <= target.t1 && 
        candidate.t2 <= target.t2 && 
        candidate.t3 <= target.t3;

      if (betterInAtLeastOne && worseInNone) {
        count++;
      }
    });

    return { index: i, count };
  });

  // Find the maximum dominance count
  const maxCount = Math.max(...dominanceCounts.map(d => d.count));

  // Filter all solutions that share that max count
  const winners = dominanceCounts
    .filter(d => d.count === maxCount)
    .map(d => solutions[d.index]);

  // Return a random one from the winners' pool
  return winners[Math.floor(Math.random() * winners.length)];
}

// Example Usage:
const data = [
  { t1: 10, t2: 20, t3: 30 }, // Dominates no one
  { t1: 5,  t2: 15, t3: 25 }, // Dominates the one above
  { t1: 5,  t2: 10, t3: 20 }, // Dominates both above
  { t1: 100, t2: 1,  t3: 1  }  // Dominates no one (non-comparable/trade-off)
];

console.log(getMostDominantSolution(data));
