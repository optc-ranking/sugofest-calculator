document.addEventListener('DOMContentLoaded', () => {
    const storedData = localStorage.getItem('sugofestCalcSetup');
    const backToEntryLink = document.getElementById('backToEntryLink');
    const downloadDetailCsvBtn = document.getElementById('downloadDetailCsvBtn');
    const downloadGraphCsvBtn = document.getElementById('downloadGraphCsvBtn');

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

    function getNextColor(analysisFullName) { /* ... as before ... */ 
        if (!assignedColors[analysisFullName]) {
            assignedColors[analysisFullName] = PREDEFINED_COLORS[colorIndexGlobal % PREDEFINED_COLORS.length];
            colorIndexGlobal++;
        }
        return assignedColors[analysisFullName];
    }
    
    function getUnitRatesAndCostForMulti(unitId, multiNumber, unitsInCurrentBanner, stepsInCurrentBanner, forUniversalPhase = false) { /* ... as before ... */ 
        const unit = unitsInCurrentBanner.find(u => u.id === unitId);
        if (!unit) return { br: 0, fpr: 0, cost: 50, isUniversal: forUniversalPhase };
        const universalBr = (parseFloat(unit.universalBaseRate) || 0) / 100;
        const universalFpr = (parseFloat(unit.universalBaseRate) || 0) / 100;
        if (forUniversalPhase) return { br: universalBr, fpr: universalFpr, cost: 50, isUniversal: true };
        let br = universalBr, fpr = universalFpr, cost = 50, stepApplied = false;
        for (const stepDef of stepsInCurrentBanner) {
            const appliesTo = Array.isArray(stepDef.appliesToMultis) ? stepDef.appliesToMultis : [];
            if (appliesTo.includes(multiNumber)) {
                cost = parseInt(stepDef.gemCost) || 50; stepApplied = true;
                const unitStepOverride = unit.stepOverrides.find(so => so.globalStepDefId === stepDef.id);
                if (unitStepOverride) {
                    br = unitStepOverride.hasOwnProperty('baseRate10Pulls') ? (parseFloat(unitStepOverride.baseRate10Pulls) || 0) / 100 : universalBr;
                    fpr = unitStepOverride.hasOwnProperty('finalPosterRate') ? (parseFloat(unitStepOverride.finalPosterRate) || 0) / 100 : universalFpr;
                }
                break;
            }
        }
        return { br, fpr, cost, isUniversal: !stepApplied };
    }

    function calculateStatsForSingleAnalysis(analysisSpec, unitsInCurrentBanner, stepsInCurrentBanner, maxMultisForDefinedSteps, bannerNameForLabel) { /* ... Hybrid EV, as before ... */ 
        const dataPoints = [];
        let cumulativeProbNotPullCurrent = 1.0;
        let totalGemsSpentCurrent = 0;
        let expectedValueGems = 0;
        const fullAnalysisName = `${bannerNameForLabel} - ${analysisSpec.name}`;

        // maxMultisForDefinedSteps here is the user-inputted total multis for THIS banner
        // The graph data points should go up to this value.
        for (let k = 1; k <= maxMultisForDefinedSteps; k++) { 
            let effBr = 0, effFpr = 0, costMK = 50;
            if (analysisSpec.type === "single_unit") { 
                const r = getUnitRatesAndCostForMulti(analysisSpec.unitId, k, unitsInCurrentBanner, stepsInCurrentBanner);
                effBr = r.br; effFpr = r.fpr; costMK = r.cost;
            } else if (analysisSpec.type === "custom_group") { 
                 let firstCost = false;
                if (analysisSpec.constituents) {
                    analysisSpec.constituents.forEach(c => {
                        if (!c.unitId) return;
                        const r = getUnitRatesAndCostForMulti(c.unitId, k, unitsInCurrentBanner, stepsInCurrentBanner);
                        const m = parseInt(c.multiplier) || 1;
                        effBr += r.br * m; effFpr += r.fpr * m;
                        if (!firstCost) { costMK = r.cost; firstCost = true; }
                    });
                }
            }
            effBr = Math.min(effBr, 1.0); effFpr = Math.min(effFpr, 1.0);
            totalGemsSpentCurrent += costMK;
            const probNotPullRaw = Math.pow(1 - effBr, 10) * (1 - effFpr);
            const probPullRaw = 1 - probNotPullRaw;
            const probSuccessFirst = cumulativeProbNotPullCurrent * probPullRaw;
            if (cumulativeProbNotPullCurrent > 1e-12) expectedValueGems += totalGemsSpentCurrent * probSuccessFirst;
            cumulativeProbNotPullCurrent *= probNotPullRaw;
            cumulativeProbNotPullCurrent = Math.max(0, Math.min(1, cumulativeProbNotPullCurrent));
            const effPulls = (totalGemsSpentCurrent / 50) * 11;
            let normRate = 0;
            if (effPulls > 0 && cumulativeProbNotPullCurrent < 1) normRate = 1 - Math.pow(cumulativeProbNotPullCurrent, 1 / effPulls);
            else if (cumulativeProbNotPullCurrent >= 1 && effPulls > 0) normRate = 0;
            
            dataPoints.push({ 
                multi: k, 
                probPullAtLeastOne: 1 - cumulativeProbNotPullCurrent, 
                normalizedRate: normRate * 100,
            });

            // For EV calc, if guaranteed, future EV contributions are 0
            if (cumulativeProbNotPullCurrent < 1e-9 && analysisSpec.type !== "custom_group_for_ev_beyond_guarantee") { // Heuristic to stop adding to EV
                // But for graph points, continue up to maxMultisForDefinedSteps
            }
        }
        // EV Phase 2 (Universal rates) - this logic applies *after* maxMultisForDefinedSteps for EV calculation
        // The dataPoints array for graph already goes up to maxMultisForDefinedSteps
        if (cumulativeProbNotPullCurrent > 1e-9) { 
            let uniBr = 0, uniFpr = 0;
            if (analysisSpec.type === "single_unit") { 
                const r = getUnitRatesAndCostForMulti(analysisSpec.unitId, -1, unitsInCurrentBanner, [], true);
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
            if (probPullUniRaw > 1e-9) {
                const evAddUni = 50 / probPullUniRaw;
                expectedValueGems += cumulativeProbNotPullCurrent * (totalGemsSpentCurrent + evAddUni);
            }
        }
        return { 
            fullAnalysisName, bannerName: bannerNameForLabel, originalAnalysisName: analysisSpec.name,
            data: dataPoints, color: getNextColor(fullAnalysisName), 
            expectedValueGems: (expectedValueGems > 0 && (1 - cumulativeProbNotPullCurrent) > 1e-9 ) ? expectedValueGems : Infinity 
            // Mark EV as Infinity if cumulative pull chance is still effectively 0 (never pulled)
        };
    }
    
    function generateDetailedMultiDataForCSV(analysisSpec, unitsInBanner, stepsInBanner, maxMultisForCSV, bannerName) { /* ... as before ... */ 
        const multiHeaders = [`${bannerName} - ${analysisSpec.name}`];
        for (let i = 1; i <= maxMultisForCSV; i++) multiHeaders.push(`Multi ${i}`);
        const cumulativeProbNotPullArray = ["Cumulative P(No Pull)"], probSuccessThisMultiArray = ["P(1st Success this Multi)"], conditionalEVArray = ["Cond. Avg. Cost from this Multi"], cumulativeGemsSpentArray = ["Cumulative Gems Spent"];
        const preCalc = { totalGemsSpent: [0], probNotPullRaw: [0], probPullRaw: [0], probFirstSuccess: [0], cumulativeProbNotPull: [1.0] };
        for (let j = 1; j <= maxMultisForCSV; j++) {
            let effBr = 0, effFpr = 0, costMJ = 50;
            let maxDefinedMulti = Math.max(...stepsInBanner.flatMap(s => Array.isArray(s.appliesToMultis) ? s.appliesToMultis : [] ), 0);
            let isUni = j > maxDefinedMulti;
            if (analysisSpec.type === "single_unit") { 
                const r = getUnitRatesAndCostForMulti(analysisSpec.unitId, j, unitsInBanner, stepsInBanner, isUni);
                effBr = r.br; effFpr = r.fpr; costMJ = r.cost;
            } else if (analysisSpec.type === "custom_group") { 
                let firstCost = false;
                if(analysisSpec.constituents) {
                    analysisSpec.constituents.forEach(c => {
                        if(!c.unitId) return;
                        const r = getUnitRatesAndCostForMulti(c.unitId, j, unitsInBanner, stepsInBanner, isUni);
                        const m = parseInt(c.multiplier) || 1;
                        effBr += r.br * m; effFpr += r.fpr * m;
                        if(!firstCost) { costMJ = r.cost; firstCost = true; }
                    });
                }
            }
            effBr = Math.min(effBr, 1.0); effFpr = Math.min(effFpr, 1.0);
            preCalc.totalGemsSpent[j] = (preCalc.totalGemsSpent[j-1] || 0) + costMJ;
            preCalc.probNotPullRaw[j] = Math.pow(1 - effBr, 10) * (1 - effFpr);
            preCalc.probPullRaw[j] = 1 - preCalc.probNotPullRaw[j];
            preCalc.probFirstSuccess[j] = (preCalc.cumulativeProbNotPull[j-1] || 0) * preCalc.probPullRaw[j];
            preCalc.cumulativeProbNotPull[j] = (preCalc.cumulativeProbNotPull[j-1] || 0) * preCalc.probNotPullRaw[j];
            preCalc.cumulativeProbNotPull[j] = Math.max(0, Math.min(1, preCalc.cumulativeProbNotPull[j]));
        }
        for (let k = 1; k <= maxMultisForCSV; k++) {
            cumulativeProbNotPullArray.push(preCalc.cumulativeProbNotPull[k].toFixed(7));
            probSuccessThisMultiArray.push(preCalc.probFirstSuccess[k].toFixed(7));
            cumulativeGemsSpentArray.push(preCalc.totalGemsSpent[k]);
            let sumNum = 0;
            for (let j = k; j <= maxMultisForCSV; j++) {
                if (preCalc.probFirstSuccess[j] > 1e-12) sumNum += preCalc.totalGemsSpent[j] * preCalc.probFirstSuccess[j];
            }
            const probFailK_1 = (k === 1) ? 1.0 : preCalc.cumulativeProbNotPull[k-1];
            const gemsK_1 = (k === 1) ? 0 : preCalc.totalGemsSpent[k-1];
            let condEVk = "N/A";
            if (probFailK_1 > 1e-12) condEVk = ((sumNum / probFailK_1) - gemsK_1).toFixed(1);
            else if (preCalc.cumulativeProbNotPull[k-1] < 1e-9) condEVk = "0.0";
            conditionalEVArray.push(condEVk);
        }
        return [multiHeaders, cumulativeGemsSpentArray, cumulativeProbNotPullArray, probSuccessThisMultiArray, conditionalEVArray];
    }

    allBannerData.forEach(banner => { /* ... (checklist population, same as before) ... */ 
        const maxMultisForThisBannerDisplay = banner.totalMultis || 30; 
        const bannerChecklistGroup = document.createElement('div');
        bannerChecklistGroup.className = 'banner-checklist-group card';
        const bannerHeader = document.createElement('h4'); bannerHeader.textContent = banner.bannerName;
        bannerChecklistGroup.appendChild(bannerHeader);
        if (banner.analysesToPerformOnResultsPage) {
            banner.analysesToPerformOnResultsPage.forEach(analysisSpec => {
                const result = calculateStatsForSingleAnalysis(analysisSpec, banner.units, banner.stepDefinitions, maxMultisForThisBannerDisplay, banner.bannerName);
                if (result.data && result.data.length > 0) {
                    allCalculatedResults.push(result); 
                    const checkboxId = `check-${result.fullAnalysisName.replace(/[^a-zA-Z0-9]/g, '-')}`;
                    const listItem = document.createElement('span'); const label = document.createElement('label'); label.htmlFor = checkboxId;
                    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = checkboxId; checkbox.value = result.fullAnalysisName;
                    checkbox.checked = true; checkbox.addEventListener('change', updateChart);
                    label.appendChild(checkbox); label.appendChild(document.createTextNode(` ${analysisSpec.name} `));
                    const evDisplay = document.createElement('span'); evDisplay.className = 'ev-display';
                    evDisplay.textContent = `(Avg. Cost: ${result.expectedValueGems === Infinity ? 'Effectively Never' : result.expectedValueGems.toFixed(1)} gems)`;
                    label.appendChild(evDisplay);
                    const colorSwatch = document.createElement('span'); colorSwatch.className = 'color-swatch'; colorSwatch.style.backgroundColor = result.color;
                    label.appendChild(colorSwatch);
                    listItem.appendChild(label); bannerChecklistGroup.appendChild(listItem);
                }
            });
        }
        if (bannerChecklistGroup.children.length > 1) checklistParentContainer.appendChild(bannerChecklistGroup);
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
            let allSelectedAreZeroOrHundred = true;

            selectedFullAnalysisNames.forEach(fullName => {
                const resultObj = allCalculatedResults.find(r => r.fullAnalysisName === fullName);
                if (resultObj && resultObj.data) {
                    resultObj.data.forEach(d => {
                        const rate = d.normalizedRate;
                        if (rate > 0.001 && rate < 99.99) { 
                            maxRelevantRate = Math.max(maxRelevantRate, rate);
                            hasAnyRelevantRate = true;
                            allSelectedAreZeroOrHundred = false;
                        } else if (rate > 0.001 && rate >= 99.99) { 
                             allSelectedAreZeroOrHundred = false; 
                        }
                    });
                }
            });

            if (hasAnyRelevantRate) {
                let padding = Math.max(0.2 * maxRelevantRate, 0.2); 
                if (maxRelevantRate < 1) padding = 0.1; 
                yAxisConfiguredMax = Math.min(100, Math.ceil((maxRelevantRate + padding) * 10) / 10); 
                if (yAxisConfiguredMax < 0.5 && maxRelevantRate > 0) yAxisConfiguredMax = 0.5;
                else if (yAxisConfiguredMax < 1 && maxRelevantRate > 0) yAxisConfiguredMax = 1;

            } else if (!allSelectedAreZeroOrHundred) { 
                let hasPositive = selectedFullAnalysisNames.some(name => {
                    const res = allCalculatedResults.find(r => r.fullAnalysisName === name);
                    return res && res.data.some(d => d.normalizedRate > 0.001);
                });
                yAxisConfiguredMax = hasPositive ? 100 : 1; 
            } else { 
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
        // *** X-AXIS FIX: Determine max multis from ALL input banner definitions ***
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
                        max: xAxisMaxMultis, // *** USE THE CORRECT MAX FOR X-AXIS ***
                        ticks: { 
                            stepSize: Math.max(1, Math.floor(xAxisMaxMultis / 20)), // Adjust step based on overall max
                            font: {size: 12}
                        }
                    },
                    y: {
                        title: { display: true, text: getYAxisLabel(selectedRateTypeKey), font: {size: 14, weight: 'bold'} },
                        beginAtZero: true, min: 0,
                        max: yAxisConfiguredMax, 
                        ticks: {
                            callback: function(value) { return value.toFixed(2) + '%'; },
                            font: {size: 12}
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { /* as before */ }
                }
            }
        };
        config.options.plugins.tooltip = { /* ... as before ... */ 
            enabled: true, mode: 'index', intersect: false, titleFont: {size: 14}, bodyFont: {size: 12},
            callbacks: {
                title: function(tooltipItems) { return `Multi: ${tooltipItems[0].label}`; },
                label: function(context) {
                    let displayLabel = context.dataset.label.split(' - ').pop() || context.dataset.label;
                    if (displayLabel) displayLabel += ': ';
                    if (context.parsed.y !== null) displayLabel += context.parsed.y.toFixed(3) + '%';
                    return displayLabel;
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
    else { /* ... error message ... */ }

    downloadDetailCsvBtn.addEventListener('click', () => { /* ... as before ... */ 
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

    downloadGraphCsvBtn.addEventListener('click', () => { /* ... as before ... */ 
        let csvContent = "";
        const maxMultisAcrossAllGraphs = Math.max(...allCalculatedResults.flatMap(res => res.data.map(d => d.multi)), 0) || 
                                         Math.max(...allBannerData.map(b => parseInt(b.totalMultis) || 0), 0) || // Also consider overall max
                                         MAX_MULTIS_FOR_CSV;
        let firstAnalysisBlock = true;
        allCalculatedResults.forEach(resultObj => {
            const graphHeaderRow = [resultObj.fullAnalysisName];
            if (firstAnalysisBlock) { 
                for (let i = 1; i <= maxMultisAcrossAllGraphs; i++) graphHeaderRow.push(`Multi ${i}`);
                csvContent += graphHeaderRow.map(escapeCsvCell).join(",") + "\n";
                firstAnalysisBlock = false;
            } else { 
                csvContent += [resultObj.fullAnalysisName, ...Array(maxMultisAcrossAllGraphs).fill("")].map(escapeCsvCell).join(",") + "\n";
            }
            const normRateRow = ["Normalized Rate (%)"], cumPullRow = ["Cumulative Pull Chance (%)"];
            const dataByMulti = new Map();
            resultObj.data.forEach(d => dataByMulti.set(d.multi, d));
            for (let i = 1; i <= maxMultisAcrossAllGraphs; i++) {
                const dataPoint = dataByMulti.get(i);
                if (dataPoint) {
                    normRateRow.push(dataPoint.normalizedRate.toFixed(3));
                    cumPullRow.push((dataPoint.probPullAtLeastOne * 100).toFixed(3));
                } else {
                    normRateRow.push(""); cumPullRow.push("");
                }
            }
            csvContent += normRateRow.map(escapeCsvCell).join(",") + "\n";
            csvContent += cumPullRow.map(escapeCsvCell).join(",") + "\n";
            csvContent += "\n"; 
        });
        triggerCsvDownload(csvContent, "sugofest_graph_data.csv");
    });

    function triggerCsvDownload(csvContent, fileName) { /* ... as before ... */ 
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url); link.setAttribute("download", fileName);
            link.style.visibility = 'hidden'; document.body.appendChild(link);
            link.click(); document.body.removeChild(link);
        } else { alert("CSV download not supported."); }
    }

    function escapeCsvCell(cellData) { /* ... as before ... */ 
        if (cellData === null || cellData === undefined) return "";
        let cellString = String(cellData);
        if (cellString.search(/("|,|\n)/g) >= 0) cellString = '"' + cellString.replace(/"/g, '""') + '"';
        return cellString;
    }

}); 

function getYAxisLabel(rateTypeKey) { /* ... as before ... */ 
    switch(rateTypeKey) {
        case "normalizedRate": return "Normalized Rate (%)";
        case "probPullAtLeastOne": return "Cumulative Pull Chance (%)";
        default: return "Value (%)";
    }
}