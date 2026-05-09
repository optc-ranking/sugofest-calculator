document.addEventListener('DOMContentLoaded', () => {
    const SAVED_SETUPS_KEY = 'sugofestMultiBannerSetups_v2';
    const LAST_CALCULATED_STATE_KEY = '__last_calculated_banner_state_v2__';
    const DEFAULT_SETUPS_MANIFEST_PATH = 'default-setups-manifest.json';
    const SELECTED_SETUP_KEY = 'sugofestHomepageSelectedSetupKey';
    const DEFAULT_SETUP_MIGRATION_KEY = 'sugofestHomepageDefaultSetupMigration';
    const DEFAULT_SETUP_MIGRATION_VALUE = '12th-anniversary';
    const DEFAULT_SETUP_KEYS = ['BUNDLED_12th_Anniversary', 'AUTOLOAD_12th_Anniversary'];
    const LEGACY_DEFAULT_SETUP_KEYS = ['BUNDLED_11th_Anniversary', 'AUTOLOAD_11th_Anniversary'];
    const PROBABILITY_THRESHOLD_FOR_100_PERCENT = 0.9999;

    const setupSelect = document.getElementById('setupSelect');
    const infographicFrame = document.querySelector('.infographic-frame');
    const infographicImage = document.getElementById('infographicImage');
    const infographicOpenBtn = document.getElementById('infographicOpenBtn');
    const overviewGraphTitle = document.getElementById('overviewGraphTitle');
    const overviewLegend = document.getElementById('overviewLegend');
    const overviewHeatmapContainer = document.getElementById('overviewHeatmapContainer');
    const highValueFilter = document.getElementById('highValueFilter');
    const imageViewer = document.getElementById('imageViewer');
    const viewerImage = document.getElementById('viewerImage');
    const viewerStage = document.getElementById('viewerStage');
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomResetBtn = document.getElementById('zoomResetBtn');
    const closeViewerBtn = document.getElementById('closeViewerBtn');
    const initialDevicePixelRatio = window.devicePixelRatio || 1;

    const colors = [
        '#1769e0', '#12834c', '#c78500', '#8b5cf6', '#db2777',
        '#0891b2', '#ea580c', '#4f46e5', '#65a30d', '#be123c',
        '#0f766e', '#dc2626', '#7c3aed', '#2563eb'
    ];
    const FIXED_HEATMAP_PRESETS = [
        {
            key: 'newLegend',
            title: 'New 11th Anni Unit, When to Swap from Part 1',
            sourceBanner: 'Part 1',
            switchAfterMulti: 30,
            rows: [
                { sourceAnalysis: 'Monster Trio + Kizaru + Nami', comparisonBanner: 'Part 2-6', comparisonAnalysis: 'New 11th Anni Legend' },
                { sourceAnalysis: 'Monster Trio + Kizaru', comparisonBanner: 'Part 2-6', comparisonAnalysis: 'New 11th Anni Legend' },
                { sourceAnalysis: '1 New Super + Nami', comparisonBanner: 'Part 2-6', comparisonAnalysis: 'New 11th Anni Legend' },
                { sourceAnalysis: 'Monster Trio or Kizaru', comparisonBanner: 'Part 2-6', comparisonAnalysis: 'New 11th Anni Legend' },
                { sourceAnalysis: 'Nami', comparisonBanner: 'Part 2-6', comparisonAnalysis: 'New 11th Anni Legend' }
            ]
        },
        {
            key: 'supers',
            title: 'All Supers / Anni Exclusives, When to Swap from Part 1',
            sourceBanner: 'Part 1',
            switchAfterMulti: 30,
            rows: [
                { sourceAnalysis: 'All Supers', comparisonBanner: 'Part 2-6', comparisonAnalysis: 'All Supers (P2-5)' },
                { sourceAnalysis: 'All Supers + Annis', comparisonBanner: 'Part 2-6', comparisonAnalysis: 'All Supers + Anni (P2-5)' }
            ]
        }
    ];

    let setups = [];
    let currentSetup = null;
    let activeMetric = 'normalizedRate';
    let activeHighValuePartFilter = 'both';
    let chartInstance = null;
    let imageZoom = 1;
    let imageFitZoom = 1;
    let viewerZoomFactor = 1;
    let isDraggingViewer = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartScrollLeft = 0;
    let dragStartScrollTop = 0;

    function getFilenameWithoutExtension(filename) {
        return filename.substring(0, filename.lastIndexOf('.')) || filename;
    }

    function getCurrentTimestamp() {
        return new Date().toISOString();
    }

    function getAnalysisId(banner, analysis) {
        if (analysis.type === 'single_unit') return `${banner.id}::single::${analysis.unitId}`;
        return `${banner.id}::custom::${analysis.analysisId}`;
    }

    function getAnalysisOptions(banners) {
        const options = [];
        banners.forEach(banner => {
            (banner.units || []).forEach(unit => {
                const analysis = {
                    type: 'single_unit',
                    unitId: unit.id,
                    name: unit.name || 'Unit'
                };
                options.push({
                    id: getAnalysisId(banner, analysis),
                    banner,
                    analysis,
                    isCustom: false
                });
            });

            (banner.customAnalyses || []).forEach(group => {
                if (!Array.isArray(group.constituents) || !group.constituents.some(c => c.unitId)) return;
                const analysis = {
                    type: 'custom_group',
                    analysisId: group.id,
                    name: group.name || 'Group',
                    constituents: group.constituents.filter(c => c.unitId)
                };
                options.push({
                    id: getAnalysisId(banner, analysis),
                    banner,
                    analysis,
                    isCustom: true
                });
            });
        });
        return options;
    }

    function getDefaultHomeGraphDefaults(banners) {
        const options = getAnalysisOptions(banners);
        const customIds = options.filter(option => option.isCustom).map(option => option.id);
        return customIds.length > 0 ? customIds : options.slice(0, 8).map(option => option.id);
    }

    function sanitizeSetupData(setup) {
        const banners = Array.isArray(setup?.banners) ? setup.banners.map((banner, bannerIndex) => ({
            id: banner.id || `banner-${bannerIndex}`,
            name: banner.name || `Banner ${bannerIndex + 1}`,
            totalMultis: parseInt(banner.totalMultis) || 30,
            steps: Array.isArray(banner.steps) ? banner.steps : [],
            units: Array.isArray(banner.units) ? banner.units : [],
            customAnalyses: Array.isArray(banner.customAnalyses) ? banner.customAnalyses : []
        })) : [];

        return {
            infographic: typeof setup?.infographic === 'string' ? setup.infographic : null,
            banners,
            homepageAnalysisDefaults: setup?.homepageAnalysisDefaults || {
                lineGraphs: setup?.homeGraphDefaults,
                heatmaps: setup?.heatmapDefaults
            },
            homeGraphDefaults: Array.isArray(setup?.homeGraphDefaults)
                ? setup.homeGraphDefaults
                : Array.isArray(setup?.homepageAnalysisDefaults?.lineGraphs)
                    ? setup.homepageAnalysisDefaults.lineGraphs
                : getDefaultHomeGraphDefaults(banners)
        };
    }

    function getSavedSetups() {
        const rawSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        return Object.entries(rawSetups)
            .filter(([, setup]) => setup && setup.data)
            .map(([key, setup]) => ({
                key,
                displayName: setup.displayName || key,
                lastModified: setup.lastModified || '1970-01-01T00:00:00.000Z',
                data: sanitizeSetupData(setup.data)
            }));
    }

    function getCurrentWorkingSetup() {
        const lastStateJson = localStorage.getItem(LAST_CALCULATED_STATE_KEY);
        if (!lastStateJson) return null;

        try {
            const lastState = JSON.parse(lastStateJson);
            if (!lastState?.data) return null;
            return {
                key: 'CURRENT_WORKING_SETUP',
                displayName: 'Current Working Setup',
                lastModified: lastState.lastModified || getCurrentTimestamp(),
                data: sanitizeSetupData(lastState.data)
            };
        } catch (error) {
            console.warn('Could not read current working setup:', error);
            return null;
        }
    }

    async function getBundledSetups() {
        try {
            const manifestResponse = await fetch(DEFAULT_SETUPS_MANIFEST_PATH);
            if (!manifestResponse.ok) return [];
            const filenames = await manifestResponse.json();
            if (!Array.isArray(filenames)) return [];

            const bundled = [];
            for (const filename of filenames) {
                try {
                    const setupResponse = await fetch(filename);
                    if (!setupResponse.ok) continue;
                    const setup = await setupResponse.json();
                    const baseName = getFilenameWithoutExtension(filename);
                    bundled.push({
                        key: `BUNDLED_${baseName.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                        displayName: `${baseName} (${new Date(setup.lastModified || getCurrentTimestamp()).toLocaleDateString()})`,
                        lastModified: setup.lastModified || getCurrentTimestamp(),
                        data: sanitizeSetupData(setup)
                    });
                } catch (error) {
                    console.warn(`Could not load bundled setup ${filename}:`, error);
                }
            }
            return bundled;
        } catch (error) {
            console.warn('Could not load bundled setup manifest:', error);
            return [];
        }
    }

    function mergeSetups(savedSetups, bundledSetups, currentWorkingSetup) {
        const setupMap = new Map();
        bundledSetups.forEach(setup => setupMap.set(setup.key, setup));
        savedSetups.forEach(setup => setupMap.set(setup.key, setup));
        if (currentWorkingSetup) setupMap.set(currentWorkingSetup.key, currentWorkingSetup);
        return Array.from(setupMap.values())
            .filter(setup => setup.data.banners.length > 0)
            .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    }

    function renderSetupSelect() {
        setupSelect.innerHTML = '';
        setups.forEach(setup => {
            setupSelect.add(new Option(setup.displayName, setup.key));
        });
    }

    function getInitialSetupKey() {
        const storedSetupKey = localStorage.getItem(SELECTED_SETUP_KEY);
        const migrationDone = localStorage.getItem(DEFAULT_SETUP_MIGRATION_KEY) === DEFAULT_SETUP_MIGRATION_VALUE;
        const defaultSetupKey = DEFAULT_SETUP_KEYS.find(key => setups.some(setup => setup.key === key));

        if (defaultSetupKey && (!storedSetupKey || (!migrationDone && LEGACY_DEFAULT_SETUP_KEYS.includes(storedSetupKey)))) {
            localStorage.setItem(DEFAULT_SETUP_MIGRATION_KEY, DEFAULT_SETUP_MIGRATION_VALUE);
            return defaultSetupKey;
        }

        return storedSetupKey;
    }

    function setCurrentSetup(setupKey) {
        currentSetup = setups.find(setup => setup.key === setupKey) || setups[0] || null;
        if (!currentSetup) {
            renderEmptyState();
            return;
        }

        setupSelect.value = currentSetup.key;
        localStorage.setItem(SELECTED_SETUP_KEY, currentSetup.key);
        saveCurrentSetupForAdvancedPages();
        renderCurrentSetup();
    }

    function renderEmptyState() {
        infographicFrame.classList.add('is-empty');
        infographicImage.removeAttribute('src');
        overviewLegend.innerHTML = '';
        if (overviewHeatmapContainer) overviewHeatmapContainer.innerHTML = '';
        overviewGraphTitle.textContent = 'Graph';
        if (chartInstance) chartInstance.destroy();
    }

    function renderCurrentSetup() {
        renderInfographic();
        drawOverviewGraph();
        renderFixedHeatmaps();
    }

    function renderInfographic() {
        const filename = currentSetup.data.infographic;
        if (!filename) {
            infographicFrame.classList.add('is-empty');
            infographicImage.removeAttribute('src');
            return;
        }
        infographicFrame.classList.remove('is-empty');
        infographicImage.src = filename;
    }

    function getSelectedSeries() {
        const options = getAnalysisOptions(currentSetup.data.banners);
        const optionMap = new Map(options.map(option => [option.id, option]));
        const configuredIds = Array.isArray(currentSetup.data.homeGraphDefaults)
            ? currentSetup.data.homeGraphDefaults
            : Array.isArray(currentSetup.data.homepageAnalysisDefaults?.lineGraphs)
                ? currentSetup.data.homepageAnalysisDefaults.lineGraphs
            : getDefaultHomeGraphDefaults(currentSetup.data.banners);
        return configuredIds
            .filter(id => optionMap.has(id))
            .map(id => optionMap.get(id))
            .filter(Boolean);
    }

    function bannerMatchesHighValueFilter(banner) {
        if (activeHighValuePartFilter === 'both') return true;
        const normalizedName = String(banner?.name || '').toLowerCase().replace(/\s+/g, '');
        if (activeHighValuePartFilter === 'part1') return normalizedName === 'part1';
        if (activeHighValuePartFilter === 'part2-6') return normalizedName === 'part2-6' || normalizedName === 'part2';
        return true;
    }

    function getUnitRatesAndCostForMulti(unitId, multiNumber, unitsInCurrentBanner, stepsInCurrentBanner, forUniversalPhase = false) {
        const unit = unitsInCurrentBanner.find(u => u.id === unitId);
        if (!unit) return { br: 0, fpr: 0, cost: 50 };

        const universalBr = (parseFloat(unit.universalBaseRate) || 0) / 100;
        const universalFpr = (parseFloat(unit.universalBaseRate) || 0) / 100;

        if (forUniversalPhase) return { br: universalBr, fpr: universalFpr, cost: 50 };

        let br = universalBr;
        let fpr = universalFpr;
        let cost = 50;

        for (const stepDef of stepsInCurrentBanner) {
            const appliesTo = Array.isArray(stepDef.appliesToMultis) ? stepDef.appliesToMultis : [];
            if (appliesTo.includes(multiNumber)) {
                cost = parseInt(stepDef.gemCost) || 50;
                const unitStepOverride = (unit.stepOverrides || []).find(so => so.globalStepDefId === stepDef.id);
                if (unitStepOverride) {
                    br = unitStepOverride.hasOwnProperty('baseRate10Pulls') ? (parseFloat(unitStepOverride.baseRate10Pulls) || 0) / 100 : universalBr;
                    fpr = unitStepOverride.hasOwnProperty('finalPosterRate') ? (parseFloat(unitStepOverride.finalPosterRate) || 0) / 100 : universalFpr;
                }
                break;
            }
        }
        return { br, fpr, cost };
    }

    function calculateStatsForAnalysis(analysisSpec, banner) {
        const dataPoints = [];
        let cumulativeProbNotPull = 1.0;
        let totalGemsSpent = 0;

        for (let multi = 1; multi <= banner.totalMultis; multi++) {
            let effBr = 0;
            let effFpr = 0;
            let cost = 50;

            if (analysisSpec.type === 'single_unit') {
                const rates = getUnitRatesAndCostForMulti(analysisSpec.unitId, multi, banner.units, banner.steps);
                effBr = rates.br;
                effFpr = rates.fpr;
                cost = rates.cost;
            } else {
                let firstCostSet = false;
                analysisSpec.constituents.forEach(constituent => {
                    const rates = getUnitRatesAndCostForMulti(constituent.unitId, multi, banner.units, banner.steps);
                    const multiplier = parseInt(constituent.multiplier) || 1;
                    effBr += rates.br * multiplier;
                    effFpr += rates.fpr * multiplier;
                    if (!firstCostSet) {
                        cost = rates.cost;
                        firstCostSet = true;
                    }
                });
            }

            effBr = Math.min(effBr, 1);
            effFpr = Math.min(effFpr, 1);
            totalGemsSpent += cost;

            const probNotPullThisMulti = Math.pow(1 - effBr, 10) * (1 - effFpr);
            const probPullThisMulti = 1 - probNotPullThisMulti;

            cumulativeProbNotPull *= probNotPullThisMulti;
            if ((1 - cumulativeProbNotPull) > PROBABILITY_THRESHOLD_FOR_100_PERCENT) {
                cumulativeProbNotPull = 0;
            }
            cumulativeProbNotPull = Math.max(0, Math.min(1, cumulativeProbNotPull));

            const effPullsEquivalent = (totalGemsSpent / 50) * 11;
            let normalizedRate = 0;
            if (effPullsEquivalent > 0) {
                normalizedRate = cumulativeProbNotPull === 0
                    ? 1
                    : 1 - Math.pow(Math.max(0, cumulativeProbNotPull), 1 / effPullsEquivalent);
            }

            dataPoints.push({
                multi,
                probPullAtLeastOne: 1 - cumulativeProbNotPull,
                normalizedRate: normalizedRate * 100,
                probSuccessOnThisMultiOnly: probPullThisMulti * 100
            });
        }

        return dataPoints;
    }

    function findBannerByName(name) {
        return currentSetup?.data?.banners?.find(banner => banner.name === name) || null;
    }

    function findAnalysisSpecByName(banner, name) {
        if (!banner) return null;

        const unit = (banner.units || []).find(item => item.name === name);
        if (unit) {
            return {
                type: 'single_unit',
                unitId: unit.id,
                name: unit.name
            };
        }

        const group = (banner.customAnalyses || []).find(item => item.name === name);
        if (!group || !Array.isArray(group.constituents) || !group.constituents.some(c => c.unitId)) return null;
        return {
            type: 'custom_group',
            analysisId: group.id,
            name: group.name,
            constituents: group.constituents.filter(c => c.unitId)
        };
    }

    function getSingleMultiSuccessChance(analysisSpec, banner, multiNumber, forUniversalPhase = false) {
        let effBr = 0;
        let effFpr = 0;
        let cost = 50;

        if (analysisSpec.type === 'single_unit') {
            const rates = getUnitRatesAndCostForMulti(analysisSpec.unitId, multiNumber, banner.units, banner.steps, forUniversalPhase);
            effBr = rates.br;
            effFpr = rates.fpr;
            cost = rates.cost;
        } else {
            let firstCostSet = false;
            (analysisSpec.constituents || []).forEach(constituent => {
                if (!constituent.unitId) return;
                const rates = getUnitRatesAndCostForMulti(constituent.unitId, multiNumber, banner.units, banner.steps, forUniversalPhase);
                const multiplier = parseInt(constituent.multiplier) || 1;
                effBr += rates.br * multiplier;
                effFpr += rates.fpr * multiplier;
                if (!firstCostSet) {
                    cost = rates.cost;
                    firstCostSet = true;
                }
            });
        }

        effBr = Math.min(effBr, 1);
        effFpr = Math.min(effFpr, 1);
        return {
            probability: 1 - (Math.pow(1 - effBr, 10) * (1 - effFpr)),
            cost
        };
    }

    function calculateExpectedValueGems(analysisSpec, banner) {
        let cumulativeProbNotPull = 1.0;
        let totalGemsSpent = 0;
        let expectedValueGems = 0;

        for (let multi = 1; multi <= banner.totalMultis; multi++) {
            const current = getSingleMultiSuccessChance(analysisSpec, banner, multi);
            totalGemsSpent += current.cost;
            const probSuccessFirstTimeThisMulti = cumulativeProbNotPull * current.probability;
            if (cumulativeProbNotPull > 1e-12) {
                expectedValueGems += totalGemsSpent * probSuccessFirstTimeThisMulti;
            }
            cumulativeProbNotPull *= (1 - current.probability);
            if ((1 - cumulativeProbNotPull) > PROBABILITY_THRESHOLD_FOR_100_PERCENT) {
                cumulativeProbNotPull = 0;
            }
            cumulativeProbNotPull = Math.max(0, Math.min(1, cumulativeProbNotPull));
        }

        if (cumulativeProbNotPull > 1e-9) {
            const universal = getSingleMultiSuccessChance(analysisSpec, banner, -1, true);
            if (universal.probability > 1e-9) {
                expectedValueGems += cumulativeProbNotPull * (totalGemsSpent + 50 / universal.probability);
            } else {
                expectedValueGems = Infinity;
            }
        }

        return expectedValueGems > 0 ? expectedValueGems : Infinity;
    }

    function calculateSwitchingEV(sourceAnalysis, sourceBanner, startMulti, switchAfterMulti, fallbackEV) {
        let cumulativeProbNotPull = 1.0;
        let totalGemsSpent = 0;
        let expectedValueGems = 0;

        for (let multi = startMulti; multi <= switchAfterMulti; multi++) {
            const current = getSingleMultiSuccessChance(sourceAnalysis, sourceBanner, multi);
            totalGemsSpent += current.cost;
            const probSuccessFirstTimeThisMulti = cumulativeProbNotPull * current.probability;
            expectedValueGems += totalGemsSpent * probSuccessFirstTimeThisMulti;
            cumulativeProbNotPull *= (1 - current.probability);
            if ((1 - cumulativeProbNotPull) > PROBABILITY_THRESHOLD_FOR_100_PERCENT) {
                cumulativeProbNotPull = 0;
            }
            cumulativeProbNotPull = Math.max(0, Math.min(1, cumulativeProbNotPull));
        }

        return expectedValueGems + cumulativeProbNotPull * (totalGemsSpent + fallbackEV);
    }

    function getHeatmapColor(value, comparisonValue) {
        if (!Number.isFinite(value) || !Number.isFinite(comparisonValue)) return 'rgb(128, 128, 128)';
        const diff = value - comparisonValue;
        const green = [94, 176, 100];
        const yellow = [245, 205, 72];
        const red = [211, 65, 65];

        if (diff <= 0) return `rgb(${green.join(', ')})`;
        if (diff >= 50) return `rgb(${red.join(', ')})`;

        const start = diff <= 25 ? green : yellow;
        const end = diff <= 25 ? yellow : red;
        const t = diff <= 25 ? diff / 25 : (diff - 25) / 25;
        const mixed = start.map((channel, index) => Math.round(channel + (end[index] - channel) * t));
        return `rgb(${mixed.join(', ')})`;
    }

    function resolveFixedHeatmapRows(preset) {
        const configuredRows = getConfiguredHeatmapRows(preset);
        if (configuredRows) return configuredRows;

        const sourceBanner = findBannerByName(preset.sourceBanner);
        if (!sourceBanner) return [];
        return preset.rows.map(row => {
            const comparisonBanner = findBannerByName(row.comparisonBanner);
            const sourceAnalysis = findAnalysisSpecByName(sourceBanner, row.sourceAnalysis);
            const comparisonAnalysis = findAnalysisSpecByName(comparisonBanner, row.comparisonAnalysis);
            if (!comparisonBanner || !sourceAnalysis || !comparisonAnalysis) return null;

            return {
                sourceBanner,
                sourceAnalysis,
                comparisonLabel: `${comparisonBanner.name} - ${comparisonAnalysis.name}`,
                comparisonEV: calculateExpectedValueGems(comparisonAnalysis, comparisonBanner)
            };
        }).filter(Boolean);
    }

    function getConfiguredHeatmapRows(preset) {
        const config = currentSetup?.data?.homepageAnalysisDefaults?.heatmaps || currentSetup?.data?.heatmapDefaults;
        if (!config) return null;
        const optionMap = new Map(getAnalysisOptions(currentSetup.data.banners).map(option => [option.id, option]));

        if (preset.key === 'newLegend') {
            const comparisonOption = optionMap.get(config.newLegend?.comparisonId);
            const rowIds = config.newLegend?.rowIds || [];
            if (!comparisonOption || rowIds.length === 0) return null;
            return rowIds.map(rowId => {
                const rowOption = optionMap.get(rowId);
                if (!rowOption) return null;
                return {
                    sourceBanner: rowOption.banner,
                    sourceAnalysis: rowOption.analysis,
                    comparisonLabel: `${comparisonOption.banner.name} - ${comparisonOption.analysis.name}`,
                    comparisonEV: calculateExpectedValueGems(comparisonOption.analysis, comparisonOption.banner)
                };
            }).filter(Boolean);
        }

        if (preset.key === 'supers') {
            const rows = config.supers?.rows || [];
            if (rows.length === 0) return null;
            return rows.map(row => {
                const rowOption = optionMap.get(row.rowId);
                const comparisonOption = optionMap.get(row.comparisonId);
                if (!rowOption || !comparisonOption) return null;
                return {
                    sourceBanner: rowOption.banner,
                    sourceAnalysis: rowOption.analysis,
                    comparisonLabel: `${comparisonOption.banner.name} - ${comparisonOption.analysis.name}`,
                    comparisonEV: calculateExpectedValueGems(comparisonOption.analysis, comparisonOption.banner)
                };
            }).filter(Boolean);
        }

        return null;
    }

    function renderFixedHeatmapSection(preset) {
        const rows = resolveFixedHeatmapRows(preset);
        if (rows.length === 0) return null;

        const section = document.createElement('section');
        section.className = 'heatmap-section';
        const switchAfterMulti = preset.switchAfterMulti || 30;
        const comparisonSummary = rows.length === 1
            ? `swap at ${rows[0].comparisonEV.toFixed(1)} gems`
            : '';

        const header = document.createElement('div');
        header.className = 'heatmap-header';
        header.innerHTML = `
            <div>
                <h3>${preset.title}</h3>
            </div>
            ${comparisonSummary ? `<div class="heatmap-x">${comparisonSummary}</div>` : ''}
        `;
        section.appendChild(header);

        const table = document.createElement('div');
        table.className = 'heatmap-grid';
        table.style.setProperty('--heatmap-columns', switchAfterMulti);

        const corner = document.createElement('div');
        corner.className = 'heatmap-corner';
        corner.textContent = 'Analysis';
        table.appendChild(corner);

        for (let multi = 1; multi <= switchAfterMulti; multi++) {
            const columnHeader = document.createElement('div');
            columnHeader.className = 'heatmap-col-header';
            columnHeader.textContent = multi;
            table.appendChild(columnHeader);
        }

        rows.forEach(row => {
            const rowHeader = document.createElement('div');
            rowHeader.className = 'heatmap-row-header';
            rowHeader.innerHTML = `<span>${row.sourceAnalysis.name}</span><small>swap at ${row.comparisonEV.toFixed(1)} gems</small>`;
            table.appendChild(rowHeader);

            for (let multi = 1; multi <= switchAfterMulti; multi++) {
                const value = calculateSwitchingEV(row.sourceAnalysis, row.sourceBanner, multi, switchAfterMulti, row.comparisonEV);
                const diff = value - row.comparisonEV;
                const cell = document.createElement('div');
                cell.className = 'heatmap-cell';
                cell.style.backgroundColor = getHeatmapColor(value, row.comparisonEV);
                cell.textContent = Number.isFinite(value) ? value.toFixed(0) : 'Inf';
                cell.title = `${row.sourceAnalysis.name}, start M${multi}: ${Number.isFinite(value) ? value.toFixed(1) : 'Effectively Never'} gems. ${Number.isFinite(diff) ? Math.abs(diff).toFixed(1) : 'Inf'} gems ${diff >= 0 ? 'more than' : 'less than'} switching now to ${row.comparisonLabel}.`;
                if (diff >= 45) cell.classList.add('heatmap-cell-dark');
                table.appendChild(cell);
            }
        });

        section.appendChild(table);
        return section;
    }

    function renderFixedHeatmaps() {
        if (!overviewHeatmapContainer) return;
        overviewHeatmapContainer.innerHTML = '';

        const sections = FIXED_HEATMAP_PRESETS.map(renderFixedHeatmapSection).filter(Boolean);
        if (sections.length === 0) {
            overviewHeatmapContainer.innerHTML = '<p class="heatmap-empty">No average-gems heatmaps are available for this setup.</p>';
            return;
        }

        const intro = document.createElement('div');
        intro.className = 'heatmap-intro';
        intro.innerHTML = `
            <p>The heatmaps show the expected number of gems needed to pull the next unit listed in each row, based on your next multi in the column. If you have done 0 multis so far, look at column 1; if you have done 5 multis so far, look at column 6.</p>
            <p>Green means it is worth continuing on Part 1. Other colours mean consider swapping to other parts. These numbers assume you swap after multi 30 no matter what.</p>
        `;
        overviewHeatmapContainer.appendChild(intro);

        sections.forEach(section => overviewHeatmapContainer.appendChild(section));

        const legend = document.createElement('div');
        legend.className = 'heatmap-legend';
        legend.innerHTML = `
            <span><i class="heatmap-legend-swatch heatmap-green"></i>Same or cheaper than switching now</span>
            <span><i class="heatmap-legend-swatch heatmap-yellow"></i>About 25 gems more</span>
            <span><i class="heatmap-legend-swatch heatmap-red"></i>50+ gems more</span>
        `;
        overviewHeatmapContainer.appendChild(legend);
    }

    function getMetricLabel(metric) {
        switch (metric) {
            case 'normalizedRate': return 'Normalized Rate (%)';
            case 'probPullAtLeastOne': return 'Cumulative Pull Chance (%)';
            case 'probSuccessOnThisMultiOnly': return 'High Value Multis (%)';
            default: return 'Value (%)';
        }
    }

    function getYAxisMax(results) {
        if (activeMetric === 'probPullAtLeastOne') return 100;

        let max = 0;
        results.forEach(result => {
            result.data.forEach(point => {
                const value = point[activeMetric] || 0;
                if (activeMetric === 'normalizedRate' && value >= 99.999) return;
                max = Math.max(max, value);
            });
        });

        if (activeMetric === 'normalizedRate' && max <= 0) return 100;
        if (max <= 0.5) return Math.ceil(max * 1.12 * 20) / 20;
        if (max <= 2) return Math.ceil(max * 1.10 * 10) / 10;
        if (max <= 5) return Math.ceil(max * 1.08 * 4) / 4;
        if (max <= 10) return Math.ceil(max * 1.06 * 2) / 2;
        return Math.min(100, Math.ceil((max * 1.05) / 2.5) * 2.5);
    }

    function drawOverviewGraph() {
        const series = getSelectedSeries()
            .filter(seriesItem => activeMetric !== 'probSuccessOnThisMultiOnly' || bannerMatchesHighValueFilter(seriesItem.banner));
        overviewGraphTitle.textContent = getMetricLabel(activeMetric).replace(' (%)', '');
        if (highValueFilter) highValueFilter.hidden = activeMetric !== 'probSuccessOnThisMultiOnly';

        const results = series.map((seriesItem, index) => ({
            name: `${seriesItem.banner.name} - ${seriesItem.analysis.name}`,
            color: colors[index % colors.length],
            banner: seriesItem.banner,
            data: calculateStatsForAnalysis(seriesItem.analysis, seriesItem.banner)
        }));

        if (results.length === 0) {
            overviewLegend.innerHTML = '<span class="legend-item">No graph defaults selected</span>';
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
            return;
        }

        overviewLegend.innerHTML = results.map(result => `
            <span class="legend-item">
                <span class="legend-swatch" style="background:${result.color}"></span>
                ${result.name}
            </span>
        `).join('');

        if (typeof Chart === 'undefined') {
            overviewGraphTitle.textContent = 'Chart unavailable';
            return;
        }

        const datasets = results.map(result => ({
            label: result.name,
            data: result.data.map(point => ({
                x: point.multi,
                y: activeMetric === 'probPullAtLeastOne' ? point.probPullAtLeastOne * 100 : point[activeMetric]
            })),
            borderColor: result.color,
            backgroundColor: result.color,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.18
        }));

        const xAxisMax = Math.max(...results.map(result => result.banner.totalMultis), 30);

        if (chartInstance) chartInstance.destroy();
        const ctx = document.getElementById('overviewChart').getContext('2d');
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'linear',
                        min: 1,
                        max: xAxisMax,
                        title: { display: true, text: 'Multi Number', font: { size: 13, weight: 'bold' } },
                        grid: { color: 'rgba(18, 32, 51, 0.08)' },
                        ticks: { stepSize: Math.max(1, Math.floor(xAxisMax / 12)) }
                    },
                    y: {
                        min: 0,
                        max: getYAxisMax(results),
                        title: { display: true, text: getMetricLabel(activeMetric), font: { size: 13, weight: 'bold' } },
                        grid: { color: 'rgba(18, 32, 51, 0.08)' },
                        ticks: {
                            callback: value => `${value}%`
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: items => `Multi ${items[0].label}`,
                            label: context => `${context.dataset.label}: ${context.parsed.y.toFixed(3)}%`
                        }
                    }
                }
            }
        });
    }

    function buildAllBannerData() {
        return currentSetup.data.banners.map(bannerData => {
            const singleUnitAnalyses = bannerData.units.map(unit => ({
                bannerName: bannerData.name,
                name: unit.name,
                type: 'single_unit',
                unitId: unit.id
            }));
            const customGroupAnalyses = (bannerData.customAnalyses || []).map(group => ({
                bannerName: bannerData.name,
                name: group.name,
                type: 'custom_group',
                analysisId: group.id,
                constituents: (group.constituents || []).filter(constituent => constituent.unitId)
            })).filter(group => group.constituents && group.constituents.length > 0);

            return {
                bannerId: bannerData.id,
                bannerName: bannerData.name,
                totalMultis: bannerData.totalMultis,
                units: bannerData.units,
                stepDefinitions: bannerData.steps,
                analysesToPerformOnResultsPage: [...singleUnitAnalyses, ...customGroupAnalyses]
            };
        }).filter(banner => banner.analysesToPerformOnResultsPage.length > 0);
    }

    function saveCurrentSetupForAdvancedPages() {
        if (!currentSetup) return;
        localStorage.setItem(LAST_CALCULATED_STATE_KEY, JSON.stringify({
            lastModified: getCurrentTimestamp(),
            data: currentSetup.data
        }));
        localStorage.setItem('sugofestCalcSetup', JSON.stringify({
            allBannerData: buildAllBannerData(),
            homepageAnalysisDefaults: currentSetup.data.homepageAnalysisDefaults || {
                lineGraphs: currentSetup.data.homeGraphDefaults,
                heatmaps: currentSetup.data.heatmapDefaults
            }
        }));
    }

    function getViewerContentBox() {
        const stageStyles = window.getComputedStyle(viewerStage);
        const horizontalPadding = parseFloat(stageStyles.paddingLeft) + parseFloat(stageStyles.paddingRight);
        const verticalPadding = parseFloat(stageStyles.paddingTop) + parseFloat(stageStyles.paddingBottom);

        return {
            width: Math.max(1, viewerStage.clientWidth - horizontalPadding),
            height: Math.max(1, viewerStage.clientHeight - verticalPadding)
        };
    }

    function calculateViewerFitZoom() {
        if (!viewerImage.naturalWidth) return;
        const contentBox = getViewerContentBox();
        return Math.min(
            contentBox.width / viewerImage.naturalWidth,
            contentBox.height / viewerImage.naturalHeight,
            1
        );
    }

    function getBrowserZoomScale() {
        const dprScale = initialDevicePixelRatio ? (window.devicePixelRatio || initialDevicePixelRatio) / initialDevicePixelRatio : 1;
        const visualScale = window.visualViewport?.scale || 1;
        return Math.max(1, dprScale, visualScale);
    }

    function getEffectiveViewerZoom() {
        return imageFitZoom * viewerZoomFactor * getBrowserZoomScale();
    }

    function getViewerMaxZoomFactor() {
        if (!imageFitZoom) return 1;
        return Math.max(1, Math.min(6, 4 / (imageFitZoom * getBrowserZoomScale())));
    }

    function updateViewerStageState() {
        const isFit = Math.abs((viewerZoomFactor * getBrowserZoomScale()) - 1) < 0.02;
        viewerStage.classList.toggle('is-fit', isFit);
        viewerStage.classList.toggle('is-zoomed', !isFit);
    }

    function applyViewerZoom() {
        if (!viewerImage.naturalWidth) return;
        imageZoom = getEffectiveViewerZoom();
        viewerImage.style.width = `${viewerImage.naturalWidth * imageZoom}px`;
        viewerImage.style.height = 'auto';
        const relativeZoom = viewerZoomFactor * getBrowserZoomScale();
        zoomResetBtn.textContent = Math.abs(relativeZoom - 1) < 0.02 ? 'Fit' : `${Math.round(relativeZoom * 100)}%`;
        updateViewerStageState();
    }

    function fitViewerImage() {
        if (!viewerImage.naturalWidth) return;
        imageFitZoom = calculateViewerFitZoom();
        viewerZoomFactor = 1;
        applyViewerZoom();
        viewerStage.scrollTo(0, 0);
    }

    function zoomViewerAtPoint(targetZoomFactor, clientX, clientY) {
        if (!viewerImage.naturalWidth) return;

        const imageRect = viewerImage.getBoundingClientRect();
        const stageRect = viewerStage.getBoundingClientRect();
        const imageXRatio = imageRect.width > 0 ? (clientX - imageRect.left) / imageRect.width : 0.5;
        const imageYRatio = imageRect.height > 0 ? (clientY - imageRect.top) / imageRect.height : 0.5;

        viewerZoomFactor = targetZoomFactor;
        applyViewerZoom();

        const newWidth = viewerImage.naturalWidth * imageZoom;
        const newHeight = viewerImage.naturalHeight * imageZoom;
        viewerStage.scrollLeft = Math.max(0, imageXRatio * newWidth - (clientX - stageRect.left));
        viewerStage.scrollTop = Math.max(0, imageYRatio * newHeight - (clientY - stageRect.top));
    }

    function toggleViewerZoom(event) {
        const maxZoomFactor = getViewerMaxZoomFactor();
        const targetZoomFactor = Math.abs(viewerZoomFactor - maxZoomFactor) < 0.02 ? 1 : maxZoomFactor;
        zoomViewerAtPoint(targetZoomFactor, event.clientX, event.clientY);
    }

    function canPanViewerImage() {
        return viewerStage.scrollWidth > viewerStage.clientWidth || viewerStage.scrollHeight > viewerStage.clientHeight;
    }

    function refreshViewerForViewportChange() {
        if (!viewerImage.naturalWidth) return;

        const oldWidth = viewerImage.naturalWidth * imageZoom;
        const oldHeight = viewerImage.naturalHeight * imageZoom;
        const centerXRatio = oldWidth > 0 ? (viewerStage.scrollLeft + viewerStage.clientWidth / 2) / oldWidth : 0.5;
        const centerYRatio = oldHeight > 0 ? (viewerStage.scrollTop + viewerStage.clientHeight / 2) / oldHeight : 0.5;

        imageFitZoom = calculateViewerFitZoom();
        applyViewerZoom();

        const newWidth = viewerImage.naturalWidth * imageZoom;
        const newHeight = viewerImage.naturalHeight * imageZoom;
        viewerStage.scrollLeft = Math.max(0, centerXRatio * newWidth - viewerStage.clientWidth / 2);
        viewerStage.scrollTop = Math.max(0, centerYRatio * newHeight - viewerStage.clientHeight / 2);
    }

    function openImageViewer() {
        if (!infographicImage.src) return;
        viewerImage.src = infographicImage.src;
        imageViewer.classList.add('is-open');
        imageViewer.setAttribute('aria-hidden', 'false');
        if (viewerImage.complete) requestAnimationFrame(fitViewerImage);
    }

    function closeImageViewer() {
        imageViewer.classList.remove('is-open');
        imageViewer.setAttribute('aria-hidden', 'true');
    }

    setupSelect.addEventListener('change', () => setCurrentSetup(setupSelect.value));
    infographicOpenBtn.addEventListener('click', openImageViewer);
    closeViewerBtn.addEventListener('click', closeImageViewer);
    zoomInBtn.addEventListener('click', () => {
        viewerZoomFactor = Math.min(getViewerMaxZoomFactor(), viewerZoomFactor + 0.25);
        applyViewerZoom();
    });
    zoomOutBtn.addEventListener('click', () => {
        viewerZoomFactor = Math.max(1, viewerZoomFactor - 0.25);
        applyViewerZoom();
    });
    zoomResetBtn.addEventListener('click', fitViewerImage);
    viewerImage.addEventListener('load', fitViewerImage);
    viewerStage.addEventListener('click', event => {
        if (dragMoved) {
            dragMoved = false;
            return;
        }
        toggleViewerZoom(event);
    });
    viewerStage.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !canPanViewerImage()) return;
        isDraggingViewer = true;
        dragMoved = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragStartScrollLeft = viewerStage.scrollLeft;
        dragStartScrollTop = viewerStage.scrollTop;
        viewerStage.classList.add('is-dragging');
        viewerStage.setPointerCapture(event.pointerId);
    });
    viewerStage.addEventListener('pointermove', event => {
        if (!isDraggingViewer) return;
        const deltaX = event.clientX - dragStartX;
        const deltaY = event.clientY - dragStartY;
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) dragMoved = true;
        viewerStage.scrollLeft = dragStartScrollLeft - deltaX;
        viewerStage.scrollTop = dragStartScrollTop - deltaY;
    });
    function stopViewerDrag(event) {
        if (!isDraggingViewer) return;
        isDraggingViewer = false;
        viewerStage.classList.remove('is-dragging');
        if (viewerStage.hasPointerCapture(event.pointerId)) viewerStage.releasePointerCapture(event.pointerId);
        if (dragMoved) window.setTimeout(() => { dragMoved = false; }, 0);
    }
    viewerStage.addEventListener('pointerup', stopViewerDrag);
    viewerStage.addEventListener('pointercancel', stopViewerDrag);
    window.addEventListener('resize', () => {
        if (imageViewer.classList.contains('is-open')) refreshViewerForViewportChange();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            if (imageViewer.classList.contains('is-open')) refreshViewerForViewportChange();
        });
    }
    imageViewer.addEventListener('click', event => {
        if (event.target === imageViewer) closeImageViewer();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && imageViewer.classList.contains('is-open')) closeImageViewer();
    });

    document.querySelectorAll('.metric-btn').forEach(button => {
        button.addEventListener('click', () => {
            activeMetric = button.dataset.metric;
            document.querySelectorAll('.metric-btn').forEach(btn => btn.classList.toggle('active', btn === button));
            drawOverviewGraph();
        });
    });

    document.querySelectorAll('.part-filter-btn').forEach(button => {
        button.addEventListener('click', () => {
            activeHighValuePartFilter = button.dataset.partFilter || 'both';
            document.querySelectorAll('.part-filter-btn').forEach(btn => btn.classList.toggle('active', btn === button));
            drawOverviewGraph();
        });
    });

    document.querySelectorAll('a[href^="detailed-input"], a[href="results.html"]').forEach(link => {
        link.addEventListener('click', () => saveCurrentSetupForAdvancedPages());
    });

    (async function initializeHomepage() {
        const savedSetups = getSavedSetups();
        const currentWorkingSetup = getCurrentWorkingSetup();
        const bundledSetups = await getBundledSetups();
        setups = mergeSetups(savedSetups, bundledSetups, currentWorkingSetup);
        renderSetupSelect();
        setCurrentSetup(getInitialSetupKey());
    })();
});
