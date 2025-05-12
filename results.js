document.addEventListener('DOMContentLoaded', () => {
    const storedData = localStorage.getItem('sugofestCalcSetup');
    const backToEntryLink = document.getElementById('backToEntryLink');
    const downloadDetailCsvBtn = document.getElementById('downloadDetailCsvBtn');
    const downloadGraphCsvBtn = document.getElementById('downloadGraphCsvBtn');

    // MODIFICATION: Update back link to trigger auto-load on index.html
    if (backToEntryLink) {
        backToEntryLink.href = "index.html?autoLoadLast=true";
    }

    if (!storedData) { 
        document.body.innerHTML = "<h1>No data found.</h1><p><a href='index.html'>Please go back to data entry.</a></p>";
        return;
    }

    const setupForAllBanners = JSON.parse(storedData);
    const allBannerData = setupForAllBanners.allBannerData;

    if (!allBannerData || !Array.isArray(allBannerData) || allBannerData.length === 0) { 
        document.body.innerHTML = "<h1>Banner data is missing or invalid.</h1><p><a href='index.html'>Go Back</a></p>";
        return;
    }

    const checklistParentContainer = document.getElementById('checklistContainerParent');
    const rateTypeSelect = document.getElementById('rateTypeSelect');
    let chartInstance = null;
    const allCalculatedResults = []; 
    
    const assignedColors = {}; 
    let colorIndexGlobal = 0;
    const PREDEFINED_COLORS = [ 
        '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', 
        '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
        '#008080', '#e6beff', '#9A6324', '#fffac8', '#800000', 
        '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'
    ];
    const MAX_MULTIS_FOR_CSV = 200;
    const PROBABILITY_THRESHOLD_FOR_100_PERCENT = 0.9999; // If cumulative P(pull) > this, treat as 100%

    function getNextColor(analysisFullName) { 
        if (!assignedColors[analysisFullName]) {
            assignedColors[analysisFullName] = PREDEFINED_COLORS[colorIndexGlobal % PREDEFINED_COLORS.length];
            colorIndexGlobal++;
        }
        return assignedColors[analysisFullName];
    }
    
    function getUnitRatesAndCostForMulti(unitId, multiNumber, unitsInCurrentBanner, stepsInCurrentBanner, forUniversalPhase = false) { 
        const unit = unitsInCurrentBanner.find(u => u.id === unitId);
        if (!unit) return { br: 0, fpr: 0, cost: 50, isUniversal: forUniversalPhase };
        const universalBr = (parseFloat(unit.universalBaseRate) || 0) / 100;
        const universalFpr = (parseFloat(unit.universalBaseRate) || 0) / 100; // Universal implies same rate for all 11
        
        if (forUniversalPhase) return { br: universalBr, fpr: universalFpr, cost: 50, isUniversal: true };

        let br = universalBr, fpr = universalFpr, cost = 50, stepApplied = false;
        
        for (const stepDef of stepsInCurrentBanner) {
            const appliesTo = Array.isArray(stepDef.appliesToMultis) ? stepDef.appliesToMultis : [];
            if (appliesTo.includes(multiNumber)) {
                cost = parseInt(stepDef.gemCost) || 50; 
                stepApplied = true;
                const unitStepOverride = unit.stepOverrides.find(so => so.globalStepDefId === stepDef.id);
                if (unitStepOverride) {
                    // Use specific override if present, otherwise fallback to universal FOR THAT STEP'S CONTEXT (before falling back to true universal)
                    br = unitStepOverride.hasOwnProperty('baseRate10Pulls') ? (parseFloat(unitStepOverride.baseRate10Pulls) || 0) / 100 : universalBr;
                    fpr = unitStepOverride.hasOwnProperty('finalPosterRate') ? (parseFloat(unitStepOverride.finalPosterRate) || 0) / 100 : universalFpr;
                } else {
                    // If no specific override for this unit on this step, it uses its universal rate
                    br = universalBr;
                    fpr = universalFpr;
                }
                break;  // Step found and applied
            }
        }
        // If no step applied to this multiNumber, it's a "universal" phase for this multi (default rates/cost)
        return { br, fpr, cost, isUniversal: !stepApplied };
    }

    function calculateStatsForSingleAnalysis(analysisSpec, unitsInCurrentBanner, stepsInCurrentBanner, maxMultisForBannerGraph, bannerNameForLabel) {
        const dataPoints = [];
        let cumulativeProbNotPullCurrent = 1.0;
        let totalGemsSpentCurrent = 0;
        let expectedValueGems = 0;
        const fullAnalysisName = `${bannerNameForLabel} - ${analysisSpec.name}`;

        for (let k = 1; k <= maxMultisForBannerGraph; k++) { 
            let effBr = 0, effFpr = 0, costMK = 50;
            if (analysisSpec.type === "single_unit") { 
                const r = getUnitRatesAndCostForMulti(analysisSpec.unitId, k, unitsInCurrentBanner, stepsInCurrentBanner);
                effBr = r.br; effFpr = r.fpr; costMK = r.cost;
            } else if (analysisSpec.type === "custom_group") { 
                let firstCostSet = false; // Ensure cost is taken from the first relevant unit in group for the step
                if (analysisSpec.constituents) {
                    analysisSpec.constituents.forEach(c => {
                        if (!c.unitId) return;
                        const r = getUnitRatesAndCostForMulti(c.unitId, k, unitsInCurrentBanner, stepsInCurrentBanner);
                        const m = parseInt(c.multiplier) || 1; // Multiplier is for rate sum, not distinct pulls
                        effBr += r.br * m; 
                        effFpr += r.fpr * m;
                        if (!firstCostSet) { costMK = r.cost; firstCostSet = true; }
                    });
                }
            }
            effBr = Math.min(effBr, 1.0); // Cap summed rates at 100% for a single pull slot
            effFpr = Math.min(effFpr, 1.0);

            totalGemsSpentCurrent += costMK;
            
            const probNotPullRawThisMulti = Math.pow(1 - effBr, 10) * (1 - effFpr);
            const probPullRawThisMulti = 1 - probNotPullRawThisMulti;
            
            const probSuccessFirstTimeThisMulti = cumulativeProbNotPullCurrent * probPullRawThisMulti;
            
            if (cumulativeProbNotPullCurrent > 1e-12) { 
                 expectedValueGems += totalGemsSpentCurrent * probSuccessFirstTimeThisMulti;
            }

            cumulativeProbNotPullCurrent *= probNotPullRawThisMulti;
            
            // --- NEW ROUNDING STEP ---
            if ((1 - cumulativeProbNotPullCurrent) > PROBABILITY_THRESHOLD_FOR_100_PERCENT) {
                cumulativeProbNotPullCurrent = 0.0; 
            }
            // --- END NEW ROUNDING STEP ---
            
            cumulativeProbNotPullCurrent = Math.max(0, Math.min(1, cumulativeProbNotPullCurrent)); // Sanitize bounds
            
            const effPullsEquivalent = (totalGemsSpentCurrent / 50) * 11; // Normalize cost to 50-gem/11-pull standard
            let normRate = 0;

            if (effPullsEquivalent > 0) {
                if (cumulativeProbNotPullCurrent === 0.0) { // Guaranteed pull
                    normRate = 1.0; // Effectively 100% normalized rate
                } else if (cumulativeProbNotPullCurrent === 1.0) { // 0% chance of having pulled
                    normRate = 0.0;
                } else {
                     // Avoid Math.pow(negative, non-integer) if cumulativeProbNotPullCurrent somehow became > 1 before sanitizing
                    normRate = 1 - Math.pow(Math.max(0, cumulativeProbNotPullCurrent), 1 / effPullsEquivalent);
                }
            }
            
            dataPoints.push({ 
                multi: k, 
                probPullAtLeastOne: 1 - cumulativeProbNotPullCurrent, 
                normalizedRate: normRate * 100,
            });
        }

        // EV Phase 2 (Universal rates for pulls beyond defined steps if not already "guaranteed")
        if (cumulativeProbNotPullCurrent > 1e-9) { // If not considered guaranteed by this point
            let uniBr = 0, uniFpr = 0;
            // Get universal rates for the unit/group
            if (analysisSpec.type === "single_unit") { 
                const r = getUnitRatesAndCostForMulti(analysisSpec.unitId, -1, unitsInCurrentBanner, [], true); // true for universal phase
                uniBr = r.br; uniFpr = r.fpr;
            } else if (analysisSpec.type === "custom_group") { 
                if (analysisSpec.constituents) {
                    analysisSpec.constituents.forEach(c => {
                        if(!c.unitId) return;
                        const r = getUnitRatesAndCostForMulti(c.unitId, -1, unitsInCurrentBanner, [], true);
                        const m = parseInt(c.multiplier) || 1;
                        uniBr += r.br * m; uniFpr += r.fpr * m;
                    });
                }
            }
            uniBr = Math.min(uniBr, 1.0); uniFpr = Math.min(uniFpr, 1.0);

            const probPullUniRaw = 1 - (Math.pow(1 - uniBr, 10) * (1 - uniFpr));

            if (probPullUniRaw > 1e-9) { // If there's a non-zero chance to pull in universal phase
                const evAdditionalGemsPerUniversalSuccess = 50 / probPullUniRaw; // Avg cost per success in uni phase
                // Add the expected cost for remaining probability, considering gems already spent
                expectedValueGems += cumulativeProbNotPullCurrent * (totalGemsSpentCurrent + evAdditionalGemsPerUniversalSuccess);
            } else if (cumulativeProbNotPullCurrent > 1e-9){ // Still not pulled, and universal rate is 0
                expectedValueGems = Infinity; 
            }
        } else if (expectedValueGems === 0 && (1 - cumulativeProbNotPullCurrent) < 1e-9) {
            // If EV is 0 because cumulativeProbNotPullCurrent was 1.0 throughout, and never pulled
             expectedValueGems = Infinity;
        }


        return { 
            fullAnalysisName, bannerName: bannerNameForLabel, originalAnalysisName: analysisSpec.name,
            data: dataPoints, color: getNextColor(fullAnalysisName), 
            // Ensure EV is Infinity if overall probability of pull is extremely low
            expectedValueGems: ((1 - cumulativeProbNotPullCurrent) > 1e-9 && expectedValueGems > 0) ? expectedValueGems : Infinity 
        };
    }
    
    function generateDetailedMultiDataForCSV(analysisSpec, unitsInBanner, stepsInBanner, maxMultisForCSV, bannerName) {
        const multiHeaders = [`${bannerName} - ${analysisSpec.name}`];
        for (let i = 1; i <= maxMultisForCSV; i++) multiHeaders.push(`Multi ${i}`);
        
        const cumulativeProbNotPullArray = ["Cumulative P(No Pull)"];
        const probSuccessThisMultiArray = ["P(1st Success this Multi)"];
        const conditionalEVArray = ["Cond. Avg. Cost from this Multi"];
        const cumulativeGemsSpentArray = ["Cumulative Gems Spent"];

        // Pre-calculate rates and costs for each multi to build the detailed table
        const preCalc = { 
            totalGemsSpent: [0], // totalGemsSpent[j] is gems spent up to AND INCLUDING multi j
            probNotPullRawThisMulti: [0], // probNotPullRawThisMulti[j] is P(no pull) for multi j itself
            probPullRawThisMulti: [0],    // probPullRawThisMulti[j] is P(pull) for multi j itself
            probFirstSuccessThisMulti: [0], // probFirstSuccessThisMulti[j] is P(1st success occurs AT multi j)
            cumulativeProbNotPull: [1.0]  // cumulativeProbNotPull[j] is P(no pull up to AND INCLUDING multi j)
        };

        for (let j = 1; j <= maxMultisForCSV; j++) {
            let effBr = 0, effFpr = 0, costMJ = 50;
            
            // Determine if this multi 'j' is beyond defined steps (i.e., should use universal rates)
            let maxDefinedMultiForStepLogic = 0;
            if (stepsInBanner && stepsInBanner.length > 0) {
                 maxDefinedMultiForStepLogic = Math.max(...stepsInBanner.flatMap(s => Array.isArray(s.appliesToMultis) ? s.appliesToMultis : [] ), 0);
            }
            let isUniversalPhaseForThisMulti = j > maxDefinedMultiForStepLogic && maxDefinedMultiForStepLogic > 0;
            if (stepsInBanner.length === 0) isUniversalPhaseForThisMulti = true; // if no steps defined, all are universal


            if (analysisSpec.type === "single_unit") { 
                const r = getUnitRatesAndCostForMulti(analysisSpec.unitId, j, unitsInBanner, stepsInBanner, isUniversalPhaseForThisMulti);
                effBr = r.br; effFpr = r.fpr; costMJ = r.cost;
            } else if (analysisSpec.type === "custom_group") { 
                let firstCostSet = false;
                if(analysisSpec.constituents) {
                    analysisSpec.constituents.forEach(c => {
                        if(!c.unitId) return;
                        const r = getUnitRatesAndCostForMulti(c.unitId, j, unitsInBanner, stepsInBanner, isUniversalPhaseForThisMulti);
                        const m = parseInt(c.multiplier) || 1;
                        effBr += r.br * m; effFpr += r.fpr * m;
                        if(!firstCostSet) { costMJ = r.cost; firstCostSet = true; }
                    });
                }
            }
            effBr = Math.min(effBr, 1.0); 
            effFpr = Math.min(effFpr, 1.0);

            preCalc.totalGemsSpent[j] = (preCalc.totalGemsSpent[j-1] || 0) + costMJ;
            preCalc.probNotPullRawThisMulti[j] = Math.pow(1 - effBr, 10) * (1 - effFpr);
            preCalc.probPullRawThisMulti[j] = 1 - preCalc.probNotPullRawThisMulti[j];
            
            // Prob of 1st success at multi j = P(no pull until j-1) * P(pull at multi j)
            preCalc.probFirstSuccessThisMulti[j] = (preCalc.cumulativeProbNotPull[j-1] || 0) * preCalc.probPullRawThisMulti[j];
            
            // Cumulative P(no pull up to multi j) = P(no pull until j-1) * P(no pull at multi j)
            preCalc.cumulativeProbNotPull[j] = (preCalc.cumulativeProbNotPull[j-1] || 0) * preCalc.probNotPullRawThisMulti[j];

            // --- NEW ROUNDING STEP for CSV Data ---
            if ((1 - preCalc.cumulativeProbNotPull[j]) > PROBABILITY_THRESHOLD_FOR_100_PERCENT) {
                preCalc.cumulativeProbNotPull[j] = 0.0;
                // If rounded to 0, it means success is guaranteed. No "first success" possible in subsequent multis.
                // Adjust probFirstSuccessThisMulti for current 'j' if rounding makes it guaranteed here.
                // This needs careful thought: if P(pull at j) was already high, rounding cumulative P(no pull) to 0
                // might make P(1st success at j) appear as if it captured all remaining probability.
                // The current P(1st success) calc is based on cumulative P(no pull *before* multi j).
                // So if rounding makes cumulative P(no pull *after* multi j) zero, that's fine.
                // We might also need to ensure that P(1st success) for *future* multis becomes 0 if already guaranteed.
                // This is naturally handled if preCalc.cumulativeProbNotPull[j-1] (for the next iteration) becomes 0.
            }
            // --- END NEW ROUNDING STEP ---
            preCalc.cumulativeProbNotPull[j] = Math.max(0, Math.min(1, preCalc.cumulativeProbNotPull[j])); // Sanitize
        }

        // Now populate the output arrays for the CSV
        for (let k = 1; k <= maxMultisForCSV; k++) {
            cumulativeProbNotPullArray.push(preCalc.cumulativeProbNotPull[k].toFixed(7));
            // If cumulativeProbNotPull[k-1] was 0 (already guaranteed), then probFirstSuccessThisMulti[k] will be 0.
            probSuccessThisMultiArray.push(preCalc.probFirstSuccessThisMulti[k].toFixed(7));
            cumulativeGemsSpentArray.push(preCalc.totalGemsSpent[k]);

            // Conditional EV: Expected additional gems to spend FROM THIS POINT (multi k) onwards,
            // GIVEN that the unit has NOT been pulled before multi k.
            let sumWeightedCostsFromK = 0;
            let sumProbsOfFirstSuccessFromK = 0;

            // Calculate sum(TotalGemsSpent[j] * P(1st success at j)) for j from k to MAX_MULTIS_FOR_CSV
            // and sum(P(1st success at j)) for j from k to MAX_MULTIS_FOR_CSV
            for (let j = k; j <= maxMultisForCSV; j++) {
                if (preCalc.probFirstSuccessThisMulti[j] > 1e-12) { // Only consider if there's a chance
                    sumWeightedCostsFromK += preCalc.totalGemsSpent[j] * preCalc.probFirstSuccessThisMulti[j];
                    sumProbsOfFirstSuccessFromK += preCalc.probFirstSuccessThisMulti[j];
                }
            }
            
            const probNotPulledBeforeK = (k === 1) ? 1.0 : preCalc.cumulativeProbNotPull[k-1];
            const gemsSpentBeforeK = (k === 1) ? 0 : preCalc.totalGemsSpent[k-1];
            let condEVkValue = "N/A";

            if (probNotPulledBeforeK < 1e-9) { // Effectively guaranteed before multi k, or impossible to reach k unpulled.
                condEVkValue = "0.0"; // No additional cost needed if already pulled.
            } else if (sumProbsOfFirstSuccessFromK < 1e-9 && probNotPulledBeforeK > 1e-9) {
                // Not pulled before k, but no chance of pulling from k onwards within CSV limit
                condEVkValue = "Effectively Never (within CSV limit)";
            } else if (sumProbsOfFirstSuccessFromK > 1e-9) {
                // Expected total gems IF NOT PULLED BEFORE K = sumWeightedCostsFromK / probNotPulledBeforeK
                // Conditional EV = (Expected total gems IF NOT PULLED BEFORE K) - GemsSpentBeforeK
                const expectedTotalCostIfUnpulledAtK = sumWeightedCostsFromK / probNotPulledBeforeK;
                condEVkValue = (expectedTotalCostIfUnpulledAtK - gemsSpentBeforeK).toFixed(1);
            }
             conditionalEVArray.push(condEVkValue);
        }
        return [multiHeaders, cumulativeGemsSpentArray, cumulativeProbNotPullArray, probSuccessThisMultiArray, conditionalEVArray];
    }

    // --- Process each banner for display (checklist, etc.) ---
    allBannerData.forEach(banner => { 
        const maxMultisForThisBannerGraph = parseInt(banner.totalMultis) || 30; 
        
        const bannerChecklistGroup = document.createElement('div');
        bannerChecklistGroup.className = 'banner-checklist-group card'; // Added 'card' for consistency
        const bannerHeader = document.createElement('h4'); 
        bannerHeader.textContent = banner.bannerName;
        bannerChecklistGroup.appendChild(bannerHeader);

        if (banner.analysesToPerformOnResultsPage) {
            banner.analysesToPerformOnResultsPage.forEach(analysisSpec => {
                const result = calculateStatsForSingleAnalysis(analysisSpec, banner.units, banner.stepDefinitions, maxMultisForThisBannerGraph, banner.bannerName);
                if (result.data && result.data.length > 0) {
                    allCalculatedResults.push(result); 

                    const checkboxId = `check-${result.fullAnalysisName.replace(/[^a-zA-Z0-9]/g, '-')}`;
                    const listItem = document.createElement('span'); // Changed from div to span for inline-flex behavior
                    const label = document.createElement('label'); 
                    label.htmlFor = checkboxId;
                    
                    const checkbox = document.createElement('input'); 
                    checkbox.type = 'checkbox'; checkbox.id = checkboxId; checkbox.value = result.fullAnalysisName;
                    checkbox.checked = true; checkbox.addEventListener('change', updateChart);
                    label.appendChild(checkbox);
                    label.appendChild(document.createTextNode(` ${analysisSpec.name} `)); 
                    
                    const evDisplay = document.createElement('span'); 
                    evDisplay.className = 'ev-display';
                    evDisplay.textContent = `(Avg. Cost: ${result.expectedValueGems === Infinity ? 'Effectively Never' : result.expectedValueGems.toFixed(1)} gems)`;
                    label.appendChild(evDisplay);

                    const colorSwatch = document.createElement('span'); 
                    colorSwatch.className = 'color-swatch'; 
                    colorSwatch.style.backgroundColor = result.color;
                    label.appendChild(colorSwatch);

                    listItem.appendChild(label); 
                    bannerChecklistGroup.appendChild(listItem);
                }
            });
        }
        if (bannerChecklistGroup.children.length > 1) { 
             checklistParentContainer.appendChild(bannerChecklistGroup);
        }
    });
    
    // --- Chart Update ---
    function updateChart() {
        const selectedRateTypeKey = rateTypeSelect.value;
        const datasets = [];
        const selectedFullAnalysisNames = Array.from(document.querySelectorAll('#checklistContainerParent input[type="checkbox"]:checked'))
                                           .map(cb => cb.value);

        let yAxisConfiguredMax; 

        if (selectedRateTypeKey === 'normalizedRate') {
            let maxRelevantRate = 0;
            let hasAnyRelevantRate = false;
            let allAreEffectivelyZeroOrHundred = true; // Assume this initially
            let hasHundredPercent = false;

            selectedFullAnalysisNames.forEach(fullName => {
                const resultObj = allCalculatedResults.find(r => r.fullAnalysisName === fullName);
                if (resultObj && resultObj.data) {
                    resultObj.data.forEach(d => {
                        const rate = d.normalizedRate;
                        if (Math.abs(rate - 100) < 0.001) {
                            hasHundredPercent = true;
                        } else if (rate > 0.001) { // Not 100 and not effectively 0
                            allAreEffectivelyZeroOrHundred = false;
                            maxRelevantRate = Math.max(maxRelevantRate, rate);
                            hasAnyRelevantRate = true;
                        } else { // Effectively 0
                           // allAreEffectivelyZeroOrHundred remains true if it was already
                        }
                    });
                }
            });
            
            if (hasAnyRelevantRate) { // There are rates between 0 and 100 (exclusive of 100)
                let padding = Math.max(0.15 * maxRelevantRate, 0.5); 
                if (maxRelevantRate < 2) padding = Math.max(padding, 0.2);
                yAxisConfiguredMax = Math.ceil(maxRelevantRate + padding);
                yAxisConfiguredMax = Math.min(yAxisConfiguredMax, 100); 
                if (maxRelevantRate < 1) yAxisConfiguredMax = Math.max(yAxisConfiguredMax, 1);
            } else if (hasHundredPercent) { // Only 0s and 100s, or just 100s
                 yAxisConfiguredMax = 100;
            } else { // All effectively zero
                yAxisConfiguredMax = 1; 
            }
        } else if (selectedRateTypeKey === 'probPullAtLeastOne') {
            yAxisConfiguredMax = 100; 
        }

        selectedFullAnalysisNames.forEach(analysisName => { 
            const resultObj = allCalculatedResults.find(r => r.fullAnalysisName === analysisName);
            if (resultObj && resultObj.data) {
                datasets.push({
                    label: resultObj.fullAnalysisName, 
                    data: resultObj.data.map(d => ({ 
                        x: d.multi, 
                        y: (selectedRateTypeKey === 'probPullAtLeastOne' ? d[selectedRateTypeKey] * 100 : d[selectedRateTypeKey]) 
                    })),
                    fill: false, borderColor: resultObj.color, backgroundColor: resultObj.color, 
                    tension: 0.1, borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 4.5
                });
            }
        });

        const data = { datasets: datasets };
        const xAxisMaxMultis = Math.max(...allBannerData.map(b => parseInt(b.totalMultis) || 0), 30);

        const config = {
            type: 'line',
            data: data,
            options: {
                responsive: true, maintainAspectRatio: false, 
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Multi Number', font: {size: 14, weight: 'bold'} },
                        min: 1,
                        max: xAxisMaxMultis, 
                        ticks: { 
                            stepSize: Math.max(1, Math.floor(xAxisMaxMultis / 20)), // Dynamic step size
                            font: {size: 12}
                        }
                    },
                    y: {
                        title: { display: true, text: getYAxisLabel(selectedRateTypeKey), font: {size: 14, weight: 'bold'} },
                        beginAtZero: true, min: 0,
                        max: yAxisConfiguredMax, 
                        ticks: {
                            callback: function(value) { return value.toFixed(selectedRateTypeKey === 'normalizedRate' && yAxisConfiguredMax <= 5 ? 2 : (yAxisConfiguredMax <=1 ? 2:0)) + '%'; }, // More precision for small scales
                            font: {size: 12}
                        }
                    }
                },
                plugins: {
                    legend: { display: false }, 
                    tooltip: { 
                        enabled: true, mode: 'index', intersect: false, titleFont: {size: 14}, bodyFont: {size: 12},
                        callbacks: {
                            title: function(tooltipItems) { return `Multi: ${tooltipItems[0].label}`; },
                            label: function(context) {
                                let displayLabel = context.dataset.label.split(' - ').pop() || context.dataset.label; // Show only unit/group name part
                                if (displayLabel) displayLabel += ': ';
                                if (context.parsed.y !== null) displayLabel += context.parsed.y.toFixed(3) + '%';
                                return displayLabel;
                            }
                        }
                    }
                }
            }
        };

        if (chartInstance) chartInstance.destroy();
        const ctx = document.getElementById('resultsChart').getContext('2d');
        if (ctx) { chartInstance = new Chart(ctx, config); } 
        else { console.error("Canvas context not found."); }
    }
    
    rateTypeSelect.addEventListener('change', updateChart);
    if(allCalculatedResults.length > 0) { updateChart(); } 
    else { 
        const chartContainerOuter = document.getElementById('chartContainerOuter');
        if (chartContainerOuter) chartContainerOuter.innerHTML = "<p>Not enough data to render chart. Please check your inputs or ensure units/analyses are defined and valid for at least one banner.</p>";
    }

    downloadDetailCsvBtn.addEventListener('click', () => { 
        let csvContent = "";
        allBannerData.forEach(banner => {
            if (banner.analysesToPerformOnResultsPage) {
                banner.analysesToPerformOnResultsPage.forEach(analysisSpec => {
                    const csvRowsArrays = generateDetailedMultiDataForCSV(analysisSpec, banner.units, banner.stepDefinitions, MAX_MULTIS_FOR_CSV, banner.bannerName);
                    csvRowsArrays.forEach(rowArray => { csvContent += rowArray.map(escapeCsvCell).join(",") + "\n"; });
                    csvContent += "\n"; 
                });
            }
            csvContent += "\n"; 
        });
        triggerCsvDownload(csvContent, "sugofest_detailed_analysis.csv");
    });

    downloadGraphCsvBtn.addEventListener('click', () => { 
        let csvContent = "";
        const xAxisMaxMultisForGraphCsv = Math.max(...allBannerData.map(b => parseInt(b.totalMultis) || 0), 30);
        let firstAnalysisBlock = true;
        allCalculatedResults.forEach(resultObj => {
            const graphHeaderRow = [resultObj.fullAnalysisName];
            if (firstAnalysisBlock) { 
                for (let i = 1; i <= xAxisMaxMultisForGraphCsv; i++) graphHeaderRow.push(`Multi ${i}`);
                csvContent += graphHeaderRow.map(escapeCsvCell).join(",") + "\n";
                firstAnalysisBlock = false;
            } else { 
                csvContent += [resultObj.fullAnalysisName, ...Array(xAxisMaxMultisForGraphCsv).fill("")].map(escapeCsvCell).join(",") + "\n";
            }
            const normRateRow = ["Normalized Rate (%)"], cumPullRow = ["Cumulative Pull Chance (%)"];
            const dataByMulti = new Map();
            resultObj.data.forEach(d => dataByMulti.set(d.multi, d));
            for (let i = 1; i <= xAxisMaxMultisForGraphCsv; i++) {
                const dataPoint = dataByMulti.get(i);
                if (dataPoint) {
                    normRateRow.push(dataPoint.normalizedRate.toFixed(3));
                    cumPullRow.push((dataPoint.probPullAtLeastOne * 100).toFixed(3));
                } else { // Fill with empty if no data point (e.g. graph shorter than max multis)
                    normRateRow.push(""); cumPullRow.push("");
                }
            }
            csvContent += normRateRow.map(escapeCsvCell).join(",") + "\n";
            csvContent += cumPullRow.map(escapeCsvCell).join(",") + "\n";
            csvContent += "\n"; 
        });
        triggerCsvDownload(csvContent, "sugofest_graph_data.csv");
    });

    function triggerCsvDownload(csvContent, fileName) { 
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url); link.setAttribute("download", fileName);
            link.style.visibility = 'hidden'; document.body.appendChild(link);
            link.click(); document.body.removeChild(link);
        } else { alert("CSV download not supported."); }
    }

    function escapeCsvCell(cellData) { 
        if (cellData === null || cellData === undefined) return "";
        let cellString = String(cellData);
        if (cellString.search(/("|,|\n)/g) >= 0) cellString = '"' + cellString.replace(/"/g, '""') + '"';
        return cellString;
    }

}); 

function getYAxisLabel(rateTypeKey) { 
    switch(rateTypeKey) {
        case "normalizedRate": return "Normalized Rate (%)";
        case "probPullAtLeastOne": return "Cumulative Pull Chance (%)";
        default: return "Value (%)";
    }
}