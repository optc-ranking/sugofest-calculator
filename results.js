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
    const PROBABILITY_THRESHOLD_FOR_100_PERCENT = 0.9999;

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
        const universalFpr = (parseFloat(unit.universalBaseRate) || 0) / 100; 
        
        if (forUniversalPhase) return { br: universalBr, fpr: universalFpr, cost: 50, isUniversal: true };

        let br = universalBr, fpr = universalFpr, cost = 50, stepApplied = false;
        
        for (const stepDef of stepsInCurrentBanner) {
            const appliesTo = Array.isArray(stepDef.appliesToMultis) ? stepDef.appliesToMultis : [];
            if (appliesTo.includes(multiNumber)) {
                cost = parseInt(stepDef.gemCost) || 50; 
                stepApplied = true;
                const unitStepOverride = unit.stepOverrides.find(so => so.globalStepDefId === stepDef.id);
                if (unitStepOverride) {
                    br = unitStepOverride.hasOwnProperty('baseRate10Pulls') ? (parseFloat(unitStepOverride.baseRate10Pulls) || 0) / 100 : universalBr;
                    fpr = unitStepOverride.hasOwnProperty('finalPosterRate') ? (parseFloat(unitStepOverride.finalPosterRate) || 0) / 100 : universalFpr;
                } else {
                    br = universalBr;
                    fpr = universalFpr;
                }
                break;  
            }
        }
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
                let firstCostSet = false; 
                if (analysisSpec.constituents) {
                    analysisSpec.constituents.forEach(c => {
                        if (!c.unitId) return;
                        const r = getUnitRatesAndCostForMulti(c.unitId, k, unitsInCurrentBanner, stepsInCurrentBanner);
                        const m = parseInt(c.multiplier) || 1; 
                        effBr += r.br * m; 
                        effFpr += r.fpr * m;
                        if (!firstCostSet) { costMK = r.cost; firstCostSet = true; }
                    });
                }
            }
            effBr = Math.min(effBr, 1.0); 
            effFpr = Math.min(effFpr, 1.0);

            totalGemsSpentCurrent += costMK;
            
            const probNotPullRawThisMulti = Math.pow(1 - effBr, 10) * (1 - effFpr);
            const probPullRawThisMulti = 1 - probNotPullRawThisMulti; // Probability of success on this multi
            
            const probSuccessFirstTimeThisMulti = cumulativeProbNotPullCurrent * probPullRawThisMulti;
            
            if (cumulativeProbNotPullCurrent > 1e-12) { 
                 expectedValueGems += totalGemsSpentCurrent * probSuccessFirstTimeThisMulti;
            }

            cumulativeProbNotPullCurrent *= probNotPullRawThisMulti;
            
            if ((1 - cumulativeProbNotPullCurrent) > PROBABILITY_THRESHOLD_FOR_100_PERCENT) {
                cumulativeProbNotPullCurrent = 0.0; 
            }
            
            cumulativeProbNotPullCurrent = Math.max(0, Math.min(1, cumulativeProbNotPullCurrent)); 
            
            const effPullsEquivalent = (totalGemsSpentCurrent / 50) * 11; 
            let normRate = 0;

            if (effPullsEquivalent > 0) {
                if (cumulativeProbNotPullCurrent === 0.0) { 
                    normRate = 1.0; 
                } else if (cumulativeProbNotPullCurrent === 1.0) { 
                    normRate = 0.0;
                } else {
                    normRate = 1 - Math.pow(Math.max(0, cumulativeProbNotPullCurrent), 1 / effPullsEquivalent);
                }
            }
            
            dataPoints.push({ 
                multi: k, 
                probPullAtLeastOne: 1 - cumulativeProbNotPullCurrent, 
                normalizedRate: normRate * 100,
                probSuccessOnThisMultiOnly: probPullRawThisMulti * 100 // Store as percentage
            });
        }

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
                const evAdditionalGemsPerUniversalSuccess = 50 / probPullUniRaw; 
                expectedValueGems += cumulativeProbNotPullCurrent * (totalGemsSpentCurrent + evAdditionalGemsPerUniversalSuccess);
            } else if (cumulativeProbNotPullCurrent > 1e-9){ 
                expectedValueGems = Infinity; 
            }
        } else if (expectedValueGems === 0 && (1 - cumulativeProbNotPullCurrent) < 1e-9) {
             expectedValueGems = Infinity;
        }

        return { 
            fullAnalysisName, bannerName: bannerNameForLabel, originalAnalysisName: analysisSpec.name,
            data: dataPoints, color: getNextColor(fullAnalysisName), 
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

        const preCalc = { 
            totalGemsSpent: [0], 
            probNotPullRawThisMulti: [0], 
            probPullRawThisMulti: [0],    
            probFirstSuccessThisMulti: [0], 
            cumulativeProbNotPull: [1.0]  
        };

        for (let j = 1; j <= maxMultisForCSV; j++) {
            let effBr = 0, effFpr = 0, costMJ = 50;
            
            let maxDefinedMultiForStepLogic = 0;
            if (stepsInBanner && stepsInBanner.length > 0) {
                 maxDefinedMultiForStepLogic = Math.max(...stepsInBanner.flatMap(s => Array.isArray(s.appliesToMultis) ? s.appliesToMultis : [] ), 0);
            }
            let isUniversalPhaseForThisMulti = j > maxDefinedMultiForStepLogic && maxDefinedMultiForStepLogic > 0;
            if (stepsInBanner.length === 0) isUniversalPhaseForThisMulti = true; 


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
            preCalc.probFirstSuccessThisMulti[j] = (preCalc.cumulativeProbNotPull[j-1] || 0) * preCalc.probPullRawThisMulti[j];
            preCalc.cumulativeProbNotPull[j] = (preCalc.cumulativeProbNotPull[j-1] || 0) * preCalc.probNotPullRawThisMulti[j];

            if ((1 - preCalc.cumulativeProbNotPull[j]) > PROBABILITY_THRESHOLD_FOR_100_PERCENT) {
                preCalc.cumulativeProbNotPull[j] = 0.0;
            }
            preCalc.cumulativeProbNotPull[j] = Math.max(0, Math.min(1, preCalc.cumulativeProbNotPull[j])); 
        }

        for (let k = 1; k <= maxMultisForCSV; k++) {
            cumulativeProbNotPullArray.push(preCalc.cumulativeProbNotPull[k].toFixed(7));
            probSuccessThisMultiArray.push(preCalc.probFirstSuccessThisMulti[k].toFixed(7));
            cumulativeGemsSpentArray.push(preCalc.totalGemsSpent[k]);

            let sumWeightedCostsFromK = 0;
            let sumProbsOfFirstSuccessFromK = 0;

            for (let j = k; j <= maxMultisForCSV; j++) {
                if (preCalc.probFirstSuccessThisMulti[j] > 1e-12) { 
                    sumWeightedCostsFromK += preCalc.totalGemsSpent[j] * preCalc.probFirstSuccessThisMulti[j];
                    sumProbsOfFirstSuccessFromK += preCalc.probFirstSuccessThisMulti[j];
                }
            }
            
            const probNotPulledBeforeK = (k === 1) ? 1.0 : preCalc.cumulativeProbNotPull[k-1];
            const gemsSpentBeforeK = (k === 1) ? 0 : preCalc.totalGemsSpent[k-1];
            let condEVkValue = "N/A";

            if (probNotPulledBeforeK < 1e-9) { 
                condEVkValue = "0.0"; 
            } else if (sumProbsOfFirstSuccessFromK < 1e-9 && probNotPulledBeforeK > 1e-9) {
                condEVkValue = "Effectively Never (within CSV limit)";
            } else if (sumProbsOfFirstSuccessFromK > 1e-9) {
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
        bannerChecklistGroup.className = 'banner-checklist-group card'; 
        const bannerHeader = document.createElement('h4'); 
        bannerHeader.textContent = banner.bannerName;
        bannerChecklistGroup.appendChild(bannerHeader);

        if (banner.analysesToPerformOnResultsPage) {
            banner.analysesToPerformOnResultsPage.forEach(analysisSpec => {
                const result = calculateStatsForSingleAnalysis(analysisSpec, banner.units, banner.stepDefinitions, maxMultisForThisBannerGraph, banner.bannerName);
                if (result.data && result.data.length > 0) {
                    allCalculatedResults.push(result); 

                    const checkboxId = `check-${result.fullAnalysisName.replace(/[^a-zA-Z0-9]/g, '-')}`;
                    const listItem = document.createElement('span'); 
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

        if (selectedRateTypeKey === 'normalizedRate' || selectedRateTypeKey === 'probSuccessOnThisMultiOnly') {
            let maxDataValue = 0; 
            let maxNonExtremeDataValue = 0; 
            let hasAnyNonExtremeValue = false;
        
            selectedFullAnalysisNames.forEach(fullName => {
                const resultObj = allCalculatedResults.find(r => r.fullAnalysisName === fullName);
                if (resultObj && resultObj.data) {
                    resultObj.data.forEach(d => {
                        const rate = d[selectedRateTypeKey]; // Use the selected key directly
                        maxDataValue = Math.max(maxDataValue, rate);
        
                        if (rate > 0.001 && rate < 99.999) { 
                            maxNonExtremeDataValue = Math.max(maxNonExtremeDataValue, rate);
                            hasAnyNonExtremeValue = true;
                        }
                    });
                }
            });
        
            if (hasAnyNonExtremeValue) {
                let topPaddingPercentage = 0.15; 
                let minimumPaddingValue = 0.1;   
        
                if (maxNonExtremeDataValue < 1) {
                    topPaddingPercentage = 0.25; 
                    minimumPaddingValue = 0.05;
                } else if (maxNonExtremeDataValue < 5) {
                    topPaddingPercentage = 0.20;
                    minimumPaddingValue = 0.1;
                }
        
                let paddedMax = maxNonExtremeDataValue * (1 + topPaddingPercentage);
                paddedMax = Math.max(paddedMax, maxNonExtremeDataValue + minimumPaddingValue); 
        
                if (paddedMax <= 0.5) yAxisConfiguredMax = Math.ceil(paddedMax * 20) / 20; 
                else if (paddedMax <= 1) yAxisConfiguredMax = Math.ceil(paddedMax * 10) / 10; 
                else if (paddedMax <= 2) yAxisConfiguredMax = Math.ceil(paddedMax * 4) / 4;   
                else if (paddedMax <= 5) yAxisConfiguredMax = Math.ceil(paddedMax * 2) / 2;   
                else if (paddedMax <= 10) yAxisConfiguredMax = Math.ceil(paddedMax);            
                else yAxisConfiguredMax = Math.ceil(paddedMax / 5) * 5;                     
        
                yAxisConfiguredMax = Math.max(yAxisConfiguredMax, 0.1); 
                yAxisConfiguredMax = Math.min(yAxisConfiguredMax, 100); 
        
            } else { 
                if (maxDataValue > 50) { 
                    yAxisConfiguredMax = 100;
                } else { 
                    yAxisConfiguredMax = 1; 
                }
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
                        y: selectedRateTypeKey === 'probPullAtLeastOne' ? d.probPullAtLeastOne * 100 : d[selectedRateTypeKey]
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
                            stepSize: Math.max(1, Math.floor(xAxisMaxMultis / 20)), 
                            font: {size: 12}
                        }
                    },
                    y: {
                        title: { display: true, text: getYAxisLabel(selectedRateTypeKey), font: {size: 14, weight: 'bold'} },
                        beginAtZero: true, min: 0,
                        max: yAxisConfiguredMax, 
                        ticks: {
                            callback: function(value) { 
                                let precision = 0;
                                if (yAxisConfiguredMax <= 0.5) precision = 2; 
                                else if (yAxisConfiguredMax <= 2) precision = 2; 
                                else if (yAxisConfiguredMax <= 5) precision = 1; 
                                else if (yAxisConfiguredMax <= 10 && yAxisConfiguredMax % 1 !== 0) precision = 1; 
                                return value.toFixed(precision) + '%'; 
                            },
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
                                let displayLabel = context.dataset.label.split(' - ').pop() || context.dataset.label; 
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
            const normRateRow = ["Normalized Rate (%)"];
            const cumPullRow = ["Cumulative Pull Chance (%)"];
            const singleMultiSuccessRow = ["Success Chance on This Multi (%)"]; // New CSV row

            const dataByMulti = new Map();
            resultObj.data.forEach(d => dataByMulti.set(d.multi, d));
            for (let i = 1; i <= xAxisMaxMultisForGraphCsv; i++) {
                const dataPoint = dataByMulti.get(i);
                if (dataPoint) {
                    normRateRow.push(dataPoint.normalizedRate.toFixed(3));
                    cumPullRow.push((dataPoint.probPullAtLeastOne * 100).toFixed(3));
                    singleMultiSuccessRow.push(dataPoint.probSuccessOnThisMultiOnly.toFixed(3)); // Add data
                } else { 
                    normRateRow.push(""); 
                    cumPullRow.push("");
                    singleMultiSuccessRow.push(""); // Add empty cell
                }
            }
            csvContent += normRateRow.map(escapeCsvCell).join(",") + "\n";
            csvContent += cumPullRow.map(escapeCsvCell).join(",") + "\n";
            csvContent += singleMultiSuccessRow.map(escapeCsvCell).join(",") + "\n"; // Add row to CSV
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
        case "probSuccessOnThisMultiOnly": return "High Value Multis (%)";
        default: return "Value (%)";
    }
}
