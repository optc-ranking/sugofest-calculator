document.addEventListener('DOMContentLoaded', async () => { // Added async for await
    // --- DOM Elements ---
    const bannerTabsContainer = document.getElementById('bannerTabsContainer');
    const activeBannerContent = document.getElementById('activeBannerContent');
    const addBannerBtn = document.getElementById('addBannerBtn');
    const renameBannerInput = document.getElementById('renameBannerInput');
    const renameBannerBtn = document.getElementById('renameBannerBtn');
    const deleteBannerBtn = document.getElementById('deleteBannerBtn');
    
    // const calculateBtnLink = document.getElementById('calculateBtnLink'); // OLD: For single button
    const calculateBtnLinks = document.querySelectorAll('.proceed-button'); // NEW: Selects all proceed buttons by class

    const saveSetupNameInput = document.getElementById('saveSetupName');
    const saveNamedStateBtn = document.getElementById('saveNamedStateBtn');
    const loadSetupSelect = document.getElementById('loadSetupSelect');
    const loadNamedStateBtn = document.getElementById('loadNamedStateBtn');
    const deleteNamedStateBtn = document.getElementById('deleteNamedStateBtn');

    const importJsonInput = document.getElementById('importJsonInput');
    const importJsonBtn = document.getElementById('importJsonBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');

    // --- Templates ---
    const bannerContentTemplate = document.getElementById('bannerContentTemplate');
    const unitTemplate = document.getElementById('unitTemplate');
    const stepDefinitionTemplate = document.getElementById('stepDefinitionTemplate');
    const unitStepRateTemplate = document.getElementById('unitStepRateTemplate');
    const analysisTargetTemplate = document.getElementById('analysisTargetTemplate');
    const constituentUnitTemplate = document.getElementById('constituentUnitTemplate');

    // --- State ---
    let banners = []; 
    let activeBannerId = null;
    let globalDefaultUnitNameCounter = 0;
    const SAVED_SETUPS_KEY = 'sugofestMultiBannerSetups_v2'; 
    const LAST_CALCULATED_STATE_KEY = '__last_calculated_banner_state_v2__';
    const DEFAULT_SETUPS_MANIFEST_PATH = 'default-setups-manifest.json';


    // --- UTILITY ---
    function generateUniqueId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    function getCurrentTimestamp() {
        return new Date().toISOString();
    }

    function getFilenameWithoutExtension(filename) {
        return filename.substring(0, filename.lastIndexOf('.')) || filename;
    }

    // --- STEP & UNIT DISPLAY UPDATES ---
    function updateStepNumbersAndDisplays() {
        if (!activeBannerId || !activeBannerContent.querySelector('.banner-data-container')) return;

        const currentBannerStepsContainer = activeBannerContent.querySelector('.steps-definition-container');
        if (!currentBannerStepsContainer) return;

        const globalStepBlocks = currentBannerStepsContainer.querySelectorAll('.step-definition-block');
        globalStepBlocks.forEach((gsBlock, index) => {
            gsBlock.querySelector('.step-number').textContent = index + 1;
            const stepDataId = gsBlock.dataset.stepId;
            const currentBannerUnitsContainer = activeBannerContent.querySelector('.units-container');
            if (!currentBannerUnitsContainer) return;
            currentBannerUnitsContainer.querySelectorAll('.unit-block').forEach(unitBlock => {
                const unitStepEntry = unitBlock.querySelector(`.unit-step-rate-entry[data-step-ref-id="${stepDataId}"]`);
                if (unitStepEntry) {
                    unitStepEntry.querySelector('.unit-step-number-display').textContent = index + 1;
                    const multiInputVal = gsBlock.querySelector('.step-multis').value;
                    unitStepEntry.querySelector('.unit-step-multis-display').textContent = multiInputVal || 'N/A';
                }
            });
        });
    }
    
    // --- UNIT MANAGEMENT ---
    function createNewUnitForActiveBanner(unitDataToLoad = null) {
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;

        const newUnitId = unitDataToLoad ? unitDataToLoad.id : generateUniqueId('unit');
        let unitName;
        if (unitDataToLoad) {
            unitName = unitDataToLoad.name;
        } else {
            let bannerUnitCounter = currentBanner.units.length + 1;
            const existingNames = new Set(currentBanner.units.map(u => u.name));
            do {
                unitName = `Unit ${bannerUnitCounter}`;
                bannerUnitCounter++;
            } while (existingNames.has(unitName));
        }
        
        const newUnitData = unitDataToLoad || {
            id: newUnitId,
            name: unitName,
            universalBaseRate: "0.500",
            stepOverrides: []
        };
        if (!unitDataToLoad) currentBanner.units.push(newUnitData);
        else if (!currentBanner.units.find(u => u.id === newUnitId)) currentBanner.units.push(newUnitData);


        const container = activeBannerContent.querySelector('.units-container');
        if (container) {
            renderUnit(container, newUnitData, currentBanner.steps);
        }
        updateAllAnalysisConstituentUnitDropdowns();
    }

    function addUnitStepRateEntryToUnit(unitBlockDOM, stepData, stepVisualIndex, savedOverride, universalRate) {
        const ratesContainer = unitBlockDOM.querySelector('.unit-steps-rates-container');
        if (!ratesContainer) { console.error("Rates container not found for unit", unitBlockDOM); return; }

        const entryInstance = unitStepRateTemplate.content.cloneNode(true);
        const entryElement = entryInstance.firstElementChild; 
        entryElement.dataset.stepRefId = stepData.id; 
        entryElement.querySelector('.unit-step-number-display').textContent = stepVisualIndex + 1;
        entryElement.querySelector('.unit-step-multis-display').textContent = (Array.isArray(stepData.appliesToMultis) ? stepData.appliesToMultis.join(',') : '') || 'N/A';
        
        const baseRateInput = entryElement.querySelector('.unit-step-base-rate');
        const finalPosterRateInput = entryElement.querySelector('.unit-step-final-poster-rate');
        if (savedOverride) {
            baseRateInput.value = savedOverride.baseRate10Pulls;
            finalPosterRateInput.value = savedOverride.finalPosterRate;
        } else {
            baseRateInput.value = universalRate;
            finalPosterRateInput.value = universalRate;
        }
        ratesContainer.appendChild(entryElement);
    }
    
    // --- STEP MANAGEMENT ---
    function createNewStepForActiveBanner(stepDataToLoad = null) {
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;

        const newStepId = stepDataToLoad ? stepDataToLoad.id : generateUniqueId('step');
        const newStepData = stepDataToLoad || { id: newStepId, appliesToMultis: [], gemCost: 50 };
        
        if (!stepDataToLoad) currentBanner.steps.push(newStepData);
        else if (!currentBanner.steps.find(s => s.id === newStepId)) currentBanner.steps.push(newStepData);


        const container = activeBannerContent.querySelector('.steps-definition-container');
        if (container) {
            renderStepDefinition(container, newStepData); 
        }
        const unitsContainerInBanner = activeBannerContent.querySelector('.units-container');
        if (unitsContainerInBanner) {
             unitsContainerInBanner.querySelectorAll('.unit-block').forEach(unitBlockDOM => {
                const unitId = unitBlockDOM.dataset.unitId;
                const unitInModel = currentBanner.units.find(u => u.id === unitId);
                if (unitInModel && !unitBlockDOM.querySelector(`.unit-step-rate-entry[data-step-ref-id="${newStepData.id}"]`)) {
                    const visualIndex = Array.from(container.children).length -1;
                     addUnitStepRateEntryToUnit(unitBlockDOM, newStepData, visualIndex, null, unitInModel.universalBaseRate);
                }
            });
        }
         updateStepNumbersAndDisplays();
    }

    // --- UI RENDERING for current active banner ---
    function renderStepDefinition(container, stepData) { 
        const stepInstance = stepDefinitionTemplate.content.cloneNode(true);
        const blockElement = stepInstance.firstElementChild; 
        blockElement.dataset.stepId = stepData.id;
        blockElement.querySelector('.step-multis').value = Array.isArray(stepData.appliesToMultis) ? stepData.appliesToMultis.join(',') : '';
        blockElement.querySelector('.step-gem-cost').value = stepData.gemCost;
        container.appendChild(blockElement);
    }

     function renderUnit(container, unitData, stepsInBanner) {
        const unitInstance = unitTemplate.content.cloneNode(true);
        const blockElement = unitInstance.firstElementChild; 
        blockElement.dataset.unitId = unitData.id;
        blockElement.querySelector('.unit-name').value = unitData.name;
        blockElement.querySelector('.unit-universal-base-rate').value = unitData.universalBaseRate;
        
        const ratesContainer = blockElement.querySelector('.unit-steps-rates-container');
        ratesContainer.innerHTML = ''; 
        stepsInBanner.forEach((step, index) => {
            const override = unitData.stepOverrides.find(so => so.globalStepDefId === step.id);
            addUnitStepRateEntryToUnit(blockElement, step, index, override, unitData.universalBaseRate);
        });
        container.appendChild(blockElement);
    }
    
    function updateUnitStepRateDisplaysForBanner(unitsToUpdate, allStepsInBanner) {
        if (!activeBannerContent.querySelector('.banner-data-container')) return;
        const currentBanner = findBannerById(activeBannerId);
        if(!currentBanner) return;

        unitsToUpdate.forEach(unitData => {
            const unitBlockDOM = activeBannerContent.querySelector(`.unit-block[data-unit-id="${unitData.id}"]`);
            if (unitBlockDOM) {
                const ratesContainer = unitBlockDOM.querySelector('.unit-steps-rates-container');
                ratesContainer.innerHTML = ''; 
                allStepsInBanner.forEach((step, index) => {
                    const override = unitData.stepOverrides.find(so => so.globalStepDefId === step.id);
                    addUnitStepRateEntryToUnit(unitBlockDOM, step, index, override, unitData.universalBaseRate);
                });
            }
        });
        updateStepNumbersAndDisplays(); 
    }

    // --- CUSTOM ANALYSIS GROUP MANAGEMENT (within active banner) ---
    function createNewAnalysisTargetForActiveBanner(analysisDataToLoad = null) {
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;

        const newAnalysisId = analysisDataToLoad ? analysisDataToLoad.id : generateUniqueId('analysis');
        const newAnalysisData = analysisDataToLoad || { 
            id: newAnalysisId, 
            name: `Custom Group ${currentBanner.customAnalyses.length + 1}`, 
            type: "custom_group", 
            constituents: [] 
        };
        if (!analysisDataToLoad) currentBanner.customAnalyses.push(newAnalysisData);
        else if (!currentBanner.customAnalyses.find(a => a.id === newAnalysisId)) currentBanner.customAnalyses.push(newAnalysisData);


        const container = activeBannerContent.querySelector('.analysis-targets-container');
        if(container) renderAnalysisTarget(container, newAnalysisData, currentBanner.units);
    }
    
    function renderAnalysisTarget(container, analysisData, unitsInBanner) {
        const instance = analysisTargetTemplate.content.cloneNode(true);
        const blockElement = instance.firstElementChild; 
        blockElement.dataset.analysisId = analysisData.id;
        blockElement.querySelector('.analysis-name').value = analysisData.name;
        const constituentsContainer = blockElement.querySelector('.constituent-units-container');
        constituentsContainer.innerHTML = ''; 
        if (analysisData.constituents) {
            analysisData.constituents.forEach(c => renderConstituentUnit(constituentsContainer, c, unitsInBanner, analysisData.id));
        }
        container.appendChild(blockElement);
    }
    
    function addConstituentUnitToGroupUI(parentAnalysisBlockDOM) {
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;
        const analysisId = parentAnalysisBlockDOM.dataset.analysisId;
        const analysisInModel = currentBanner.customAnalyses.find(a => a.id === analysisId);
        if (!analysisInModel) return;

        const newConstituentId = generateUniqueId('constituent');
        const newConstituentData = { id: newConstituentId, unitId: null, multiplier: 1 };
        if (currentBanner.units.length > 0) newConstituentData.unitId = currentBanner.units[0].id; 
        analysisInModel.constituents.push(newConstituentData);

        const container = parentAnalysisBlockDOM.querySelector('.constituent-units-container');
        renderConstituentUnit(container, newConstituentData, currentBanner.units, analysisId);
    }
    
    function renderConstituentUnit(container, constituentData, unitsInBanner, parentAnalysisId) {
        const instance = constituentUnitTemplate.content.cloneNode(true);
        const entryElement = instance.firstElementChild; 
        entryElement.dataset.constituentId = constituentData.id;
        entryElement.dataset.parentAnalysisId = parentAnalysisId;

        const unitSelect = entryElement.querySelector('.constituent-unit-select');
        const multiplierInput = entryElement.querySelector('.constituent-unit-multiplier');

        populateUnitDropdownForAnalysis(unitSelect, unitsInBanner, constituentData.unitId);
        constituentData.unitId = unitSelect.value; 
        multiplierInput.value = constituentData.multiplier;
        container.appendChild(entryElement);
    }

    function populateUnitDropdownForAnalysis(selectElement, unitsInBanner, desiredValue = null) {
        const originalValueBeforeRepopulate = selectElement.value;
        selectElement.innerHTML = ''; 
        if (!unitsInBanner || unitsInBanner.length === 0) {
            selectElement.add(new Option("No units in banner", "", true, true));
            selectElement.value = ""; return;
        }
        let valueToSet = desiredValue;
        let desiredValueExists = unitsInBanner.some(unit => unit.id === desiredValue);
        if (desiredValue && !desiredValueExists && unitsInBanner.some(unit => unit.id === originalValueBeforeRepopulate)) {
            valueToSet = originalValueBeforeRepopulate; desiredValueExists = true;
        } else if (!desiredValueExists && unitsInBanner.length > 0) valueToSet = unitsInBanner[0].id;
        else if (!desiredValueExists && unitsInBanner.length === 0) valueToSet = "";
        unitsInBanner.forEach(unit => selectElement.add(new Option(unit.name || `Unnamed Unit`, unit.id)));
        selectElement.value = valueToSet;
        if (selectElement.value === "" && selectElement.options.length > 0 && !unitsInBanner.some(u => u.id === valueToSet)) {
             if(unitsInBanner.length > 0) selectElement.value = unitsInBanner[0].id;
        }
    }
    
    function updateAllAnalysisConstituentUnitDropdowns() {
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner || !activeBannerContent.querySelector('.banner-data-container')) return;
        activeBannerContent.querySelectorAll('.analysis-target-block').forEach(analysisBlock => {
            const analysisId = analysisBlock.dataset.analysisId;
            const analysisInModel = currentBanner.customAnalyses.find(a => a.id === analysisId);
            if (analysisInModel) {
                analysisBlock.querySelectorAll('.constituent-unit-entry').forEach(constituentEntry => {
                    const constituentId = constituentEntry.dataset.constituentId;
                    const constituentInModel = analysisInModel.constituents.find(c => c.id === constituentId);
                    const selectElement = constituentEntry.querySelector('.constituent-unit-select');
                    if (selectElement && constituentInModel) {
                        populateUnitDropdownForAnalysis(selectElement, currentBanner.units, constituentInModel.unitId);
                        constituentInModel.unitId = selectElement.value; 
                    }
                });
            }
        });
    }
    
    // --- BANNER MANAGEMENT (Tabs, Active State) ---
    function addBanner(bannerToLoad = null) {
        globalDefaultUnitNameCounter = 0; 
        const bannerId = bannerToLoad ? bannerToLoad.id : generateUniqueId('banner');
        const bannerName = bannerToLoad ? bannerToLoad.name : `Banner ${banners.length + 1}`;
        
        const newBannerData = bannerToLoad || {
            id: bannerId, name: bannerName, totalMultis: 30,
            steps: [], units: [], customAnalyses: []
        };
        if (bannerToLoad) {
            newBannerData.steps.forEach(s => s.id = s.id || generateUniqueId('step'));
            newBannerData.units.forEach(u => u.id = u.id || generateUniqueId('unit'));
            newBannerData.customAnalyses = (newBannerData.customAnalyses || []).map(a => ({
                ...a,
                id: a.id || generateUniqueId('analysis'),
                constituents: (a.constituents || []).map(c => ({ ...c, id: c.id || generateUniqueId('constituent') }))
            }));
        }

        banners.push(newBannerData);
        renderBannerTabs();

        if (!bannerToLoad) { 
            const defaultStep = { id: generateUniqueId('step'), appliesToMultis: [], gemCost: 50 };
            newBannerData.steps.push(defaultStep);
            globalDefaultUnitNameCounter++;
            const defaultUnit = { 
                id: generateUniqueId('unit'), name: `Unit ${globalDefaultUnitNameCounter}`, 
                universalBaseRate: "0.500", stepOverrides: [] 
            };
            newBannerData.units.push(defaultUnit);
        }
        setActiveBanner(bannerId);
        return bannerId;
    }

    function setActiveBanner(bannerId) {
        activeBannerId = bannerId;
        const bannerData = findBannerById(bannerId);
        if (bannerData) {
            populateBannerContent(bannerData);
            renameBannerInput.value = bannerData.name;
        }
        renderBannerTabs();
    }

    function populateBannerContent(bannerData) {
         if (!bannerData) {
            activeBannerContent.innerHTML = '<p class="error-message">Error: Selected banner data not found.</p>'; return;
        }
        activeBannerContent.innerHTML = ''; 
        const bannerInstance = bannerContentTemplate.content.cloneNode(true);
        const dataContainer = bannerInstance.firstElementChild; 
        dataContainer.dataset.bannerId = bannerData.id; 

        dataContainer.querySelector('.total-multis-input').value = bannerData.totalMultis;
        
        const stepsContainer = dataContainer.querySelector('.steps-definition-container');
        stepsContainer.innerHTML = ''; 
        bannerData.steps.forEach(step => renderStepDefinition(stepsContainer, step));

        const unitsContainerElement = dataContainer.querySelector('.units-container');
        unitsContainerElement.innerHTML = '';
        bannerData.units.forEach(unit => renderUnit(unitsContainerElement, unit, bannerData.steps));
        
        const analysesContainer = dataContainer.querySelector('.analysis-targets-container');
        analysesContainer.innerHTML = '';
        if (bannerData.customAnalyses) {
            bannerData.customAnalyses.forEach(analysis => renderAnalysisTarget(analysesContainer, analysis, bannerData.units));
        } else {
            bannerData.customAnalyses = []; 
        }
        activeBannerContent.appendChild(dataContainer);
        updateStepNumbersAndDisplays(); 
    }

    function deleteActiveBanner() {
        if (!activeBannerId || banners.length <= 1) { alert("Cannot delete the last banner."); return; }
        const bannerToDelete = findBannerById(activeBannerId);
        if (!confirm(`Delete banner "${bannerToDelete.name}"?`)) return;
        banners = banners.filter(b => b.id !== activeBannerId);
        activeBannerId = banners.length > 0 ? banners[0].id : null;
        renderBannerTabs();
        if (activeBannerId) setActiveBanner(activeBannerId);
        else activeBannerContent.innerHTML = '<p>No active banner.</p>';
    }
    function renameActiveBanner() { 
        if (!activeBannerId) return;
        const newName = renameBannerInput.value.trim();
        if (!newName) { alert("Banner name cannot be empty."); return; }
        const banner = findBannerById(activeBannerId);
        if (banner) { banner.name = newName; renderBannerTabs(); }
    }
    function findBannerById(id) { return banners.find(b => b.id === id); }
    function renderBannerTabs() { 
        bannerTabsContainer.innerHTML = '';
        banners.forEach(banner => {
            const tab = document.createElement('div');
            tab.className = 'banner-tab'; tab.textContent = banner.name; tab.dataset.bannerId = banner.id;
            if (banner.id === activeBannerId) tab.classList.add('active');
            tab.addEventListener('click', () => setActiveBanner(banner.id));
            bannerTabsContainer.appendChild(tab);
        });
    }


    // --- EVENT HANDLERS (Main buttons and delegated ones) ---
    addBannerBtn.addEventListener('click', () => addBanner(null)); 
    renameBannerBtn.addEventListener('click', renameActiveBanner);
    deleteBannerBtn.addEventListener('click', deleteActiveBanner);

    activeBannerContent.addEventListener('click', (e) => { 
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;

        if (e.target.matches('.add-step-btn')) createNewStepForActiveBanner(null);
        if (e.target.matches('.step-definition-block .remove-item-btn')) {
            const stepBlock = e.target.closest('.step-definition-block');
            const stepId = stepBlock.dataset.stepId;
            currentBanner.steps = currentBanner.steps.filter(s => s.id !== stepId);
            currentBanner.units.forEach(u => u.stepOverrides = u.stepOverrides.filter(so => so.globalStepDefId !== stepId));
            stepBlock.remove(); 
            updateUnitStepRateDisplaysForBanner(currentBanner.units, currentBanner.steps);
            updateStepNumbersAndDisplays();
        }
        if (e.target.matches('.add-unit-btn')) createNewUnitForActiveBanner(null);
        if (e.target.matches('.unit-block .remove-item-btn')) {
            const unitBlock = e.target.closest('.unit-block');
            const unitId = unitBlock.dataset.unitId;
            currentBanner.units = currentBanner.units.filter(u => u.id !== unitId);
            currentBanner.customAnalyses.forEach(analysis => {
                analysis.constituents = analysis.constituents.filter(c => c.unitId !== unitId);
                 const analysisBlockDOM = activeBannerContent.querySelector(`.analysis-target-block[data-analysis-id="${analysis.id}"]`);
                if (analysisBlockDOM) { 
                    const constituentsContainer = analysisBlockDOM.querySelector('.constituent-units-container');
                    constituentsContainer.innerHTML = ''; 
                    analysis.constituents.forEach(c => renderConstituentUnit(constituentsContainer, c, currentBanner.units, analysis.id));
                }
            });
            unitBlock.remove(); 
            updateAllAnalysisConstituentUnitDropdowns();
        }
        if (e.target.matches('.unit-block .use-base-rate-btn')) { 
             const unitBlock = e.target.closest('.unit-block');
            const unitId = unitBlock.dataset.unitId;
            const unitData = currentBanner.units.find(u => u.id === unitId);
            if (unitData) {
                const universalRate = unitBlock.querySelector('.unit-universal-base-rate').value;
                unitData.universalBaseRate = universalRate;
                unitData.stepOverrides = []; 
                updateUnitStepRateDisplaysForBanner([unitData], currentBanner.steps);
            }
        }
        if (e.target.matches('.add-analysis-target-btn')) createNewAnalysisTargetForActiveBanner(null);
        if (e.target.matches('.analysis-target-block .remove-item-btn')) {
            const analysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = analysisBlock.dataset.analysisId;
            currentBanner.customAnalyses = currentBanner.customAnalyses.filter(a => a.id !== analysisId);
            analysisBlock.remove();
        }
        if (e.target.matches('.analysis-target-block .add-constituent-unit-btn')) {
            const parentAnalysisBlockDOM = e.target.closest('.analysis-target-block');
            addConstituentUnitToGroupUI(parentAnalysisBlockDOM);
        }
        if (e.target.matches('.constituent-unit-entry .remove-constituent-btn')) {
            const constituentEntry = e.target.closest('.constituent-unit-entry');
            const analysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = analysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            if (analysisData) {
                const constituentId = constituentEntry.dataset.constituentId;
                analysisData.constituents = analysisData.constituents.filter(c => c.id !== constituentId);
            }
            constituentEntry.remove();
        }
    });

    activeBannerContent.addEventListener('change', (e) => { 
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;
        if (e.target.matches('.total-multis-input')) currentBanner.totalMultis = parseInt(e.target.value) || 30;
        const stepBlock = e.target.closest('.step-definition-block');
        if (stepBlock) { 
            const stepId = stepBlock.dataset.stepId;
            const stepData = currentBanner.steps.find(s => s.id === stepId);
            if(stepData){
                if (e.target.matches('.step-multis')) {
                    stepData.appliesToMultis = e.target.value.split(',').map(s=>s.trim()).filter(Boolean).map(Number);
                    updateUnitStepRateDisplaysForBanner(currentBanner.units, currentBanner.steps); 
                    updateStepNumbersAndDisplays();
                } else if (e.target.matches('.step-gem-cost')) stepData.gemCost = parseInt(e.target.value) || 50;
            }
        }
        const unitBlock = e.target.closest('.unit-block');
        if (unitBlock) { 
            const unitId = unitBlock.dataset.unitId;
            const unitData = currentBanner.units.find(u => u.id === unitId);
            if(unitData){
                if (e.target.matches('.unit-name')) { unitData.name = e.target.value; updateAllAnalysisConstituentUnitDropdowns(); } 
                else if (e.target.matches('.unit-universal-base-rate')) unitData.universalBaseRate = e.target.value;
            }
        }
        const unitStepRateEntry = e.target.closest('.unit-step-rate-entry');
        if (unitStepRateEntry) { 
            const parentUnitBlock = e.target.closest('.unit-block');
            const unitId = parentUnitBlock.dataset.unitId;
            const unitData = currentBanner.units.find(u => u.id === unitId);
            const stepRefId = unitStepRateEntry.dataset.stepRefId;
            if (unitData && stepRefId) {
                let override = unitData.stepOverrides.find(so => so.globalStepDefId === stepRefId);
                if (!override) { override = { globalStepDefId: stepRefId }; unitData.stepOverrides.push(override); }
                if (e.target.matches('.unit-step-base-rate')) override.baseRate10Pulls = e.target.value;
                if (e.target.matches('.unit-step-final-poster-rate')) override.finalPosterRate = e.target.value;
            }
        }
        const analysisBlock = e.target.closest('.analysis-target-block');
        if (analysisBlock) { 
            const analysisId = analysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            if (analysisData && e.target.matches('.analysis-name')) analysisData.name = e.target.value;
        }
        const constituentEntry = e.target.closest('.constituent-unit-entry');
        if (constituentEntry) { 
            const parentAnalysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = parentAnalysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            const constituentId = constituentEntry.dataset.constituentId;
            const constituentInModel = analysisData ? analysisData.constituents.find(c => c.id === constituentId) : null;
            if (constituentInModel) {
                if (e.target.matches('.constituent-unit-select')) constituentInModel.unitId = e.target.value;
                if (e.target.matches('.constituent-unit-multiplier')) constituentInModel.multiplier = parseInt(e.target.value) || 1;
            }
        }
    });

    // --- NAMED SAVE/LOAD STATE ---
    function listSavedSetups() {
        loadSetupSelect.innerHTML = '<option value="">-- Select a saved setup --</option>';
        const allSetupsRaw = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        
        const setupsArray = Object.entries(allSetupsRaw).map(([name, setupObj]) => ({
            name, 
            displayName: setupObj.displayName || name, 
            lastModified: setupObj.lastModified || '1970-01-01T00:00:00.000Z', 
            data: setupObj.data || setupObj 
        }));

        setupsArray.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

        setupsArray.forEach(setup => {
            const option = new Option(setup.displayName, setup.name); 
            loadSetupSelect.add(option);
        });
    }

    saveNamedStateBtn.addEventListener('click', () => {
        const name = saveSetupNameInput.value.trim();
        if (!name) { alert('Please enter a name for the setup.'); return; }
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        
        const currentTimestamp = getCurrentTimestamp();
        const displayName = `${name} (${new Date(currentTimestamp).toLocaleString()})`;

        allSetups[name] = { 
            displayName: displayName,
            lastModified: currentTimestamp,
            data: getCurrentState() 
        };
        localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allSetups));
        alert(`Setup "${name}" saved!`);
        listSavedSetups();
        loadSetupSelect.value = name; 
    });

    loadNamedStateBtn.addEventListener('click', () => {
        const nameKey = loadSetupSelect.value; 
        if (!nameKey) { alert('Please select a setup to load.'); return; }
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        const setupToLoad = allSetups[nameKey];
        
        if (setupToLoad && (setupToLoad.data || Array.isArray(setupToLoad))) { 
            const bannersData = setupToLoad.data || setupToLoad; 
            applyState(bannersData);
            saveSetupNameInput.value = nameKey.startsWith("AUTOLOAD_") || nameKey.startsWith("FILEIMPORT_") ? 
                                        getFilenameWithoutExtension(setupToLoad.originalFilename || nameKey) : nameKey;
            alert(`Setup "${setupToLoad.displayName || nameKey}" loaded!`);
        } else {
            alert(`Could not load setup "${nameKey}". It might be corrupted or in an old format.`);
        }
    });

    deleteNamedStateBtn.addEventListener('click', () => {
        const nameKey = loadSetupSelect.value; 
        if (!nameKey) { alert('Please select a setup to delete.'); return; }
        
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        const displayNameToDelete = (allSetups[nameKey] && allSetups[nameKey].displayName) ? allSetups[nameKey].displayName : nameKey;

        if (!confirm(`Are you sure you want to delete the setup "${displayNameToDelete}"? This cannot be undone.`)) return;
        
        delete allSetups[nameKey];
        localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allSetups));
        alert(`Setup "${displayNameToDelete}" deleted.`);
        listSavedSetups();
        saveSetupNameInput.value = '';
    });
    
    function getCurrentState() {
        return JSON.parse(JSON.stringify(banners)); 
    }

    function applyState(bannersToLoad) {
        banners = []; activeBannerId = null; activeBannerContent.innerHTML = ''; globalDefaultUnitNameCounter = 0;
        
        if (!Array.isArray(bannersToLoad)) {
            console.error("Invalid state to apply: bannersToLoad is not an array.", bannersToLoad);
            alert("Error: The loaded setup data is invalid.");
            addBanner(null); 
            return;
        }

        bannersToLoad.forEach(bannerData => {
            const bannerId = bannerData.id || generateUniqueId('banner');
            const loadedBanner = {
                id: bannerId,
                name: bannerData.name || `Banner ${banners.length + 1}`,
                totalMultis: bannerData.totalMultis || 30,
                steps: (bannerData.steps || []).map(s => ({...s, id: s.id || generateUniqueId('step')}) ),
                units: (bannerData.units || []).map(u => ({...u, id: u.id || generateUniqueId('unit'), stepOverrides: u.stepOverrides || [] }) ),
                customAnalyses: (bannerData.customAnalyses || []).map(a => ({
                    ...a, 
                    id: a.id || generateUniqueId('analysis'),
                    constituents: (a.constituents || []).map(c => ({...c, id: c.id || generateUniqueId('constituent')}))
                }))
            };
            banners.push(loadedBanner);
        });

        renderBannerTabs();
        if (banners.length > 0) {
            setActiveBanner(banners[0].id); 
        } else {
            addBanner(null);
        }
    }

    // --- JSON IMPORT/EXPORT & SERVER AUTO-LOAD ---
    async function fetchAndLoadServerSetups() {
        try {
            const manifestResponse = await fetch(DEFAULT_SETUPS_MANIFEST_PATH);
            if (!manifestResponse.ok) {
                if (manifestResponse.status === 404) {
                    console.log(`'${DEFAULT_SETUPS_MANIFEST_PATH}' not found. Skipping server auto-load.`);
                } else {
                    console.error(`Error fetching '${DEFAULT_SETUPS_MANIFEST_PATH}': ${manifestResponse.statusText}`);
                }
                return;
            }
            const setupFilenames = await manifestResponse.json();
            if (!Array.isArray(setupFilenames)) {
                console.error(`'${DEFAULT_SETUPS_MANIFEST_PATH}' is not a valid JSON array.`);
                return;
            }

            const allLocalStorageSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
            let setupsModified = false;

            for (const filename of setupFilenames) {
                try {
                    const setupResponse = await fetch(filename);
                    if (!setupResponse.ok) {
                        console.warn(`Could not fetch server setup '${filename}': ${setupResponse.statusText}`);
                        continue;
                    }
                    const serverSetup = await setupResponse.json();

                    if (!serverSetup.banners || !Array.isArray(serverSetup.banners) || !serverSetup.lastModified) {
                        console.warn(`Server setup file '${filename}' has invalid format. Skipping.`);
                        continue;
                    }
                    
                    const baseFilename = getFilenameWithoutExtension(filename);
                    const displayName = `${baseFilename} (${new Date(serverSetup.lastModified).toLocaleDateString()})`;
                    const storageKey = `AUTOLOAD_${baseFilename.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                    allLocalStorageSetups[storageKey] = {
                        displayName: displayName,
                        originalFilename: filename, 
                        lastModified: serverSetup.lastModified,
                        data: serverSetup.banners
                    };
                    setupsModified = true;
                    console.log(`Auto-loaded server setup '${filename}' as '${displayName}'.`);

                } catch (fileError) {
                    console.error(`Error processing server setup file '${filename}':`, fileError);
                }
            }
            if (setupsModified) {
                localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allLocalStorageSetups));
            }

        } catch (manifestError) {
            console.error(`Error fetching or processing '${DEFAULT_SETUPS_MANIFEST_PATH}':`, manifestError);
        }
    }


    exportJsonBtn.addEventListener('click', () => {
        const currentSetup = {
            lastModified: getCurrentTimestamp(),
            banners: getCurrentState() 
        };
        const jsonString = JSON.stringify(currentSetup, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestampForFile = currentSetup.lastModified.replace(/[:.]/g, '-');
        a.href = url;
        a.download = `sugofest_setup_${timestampForFile}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('Current setup exported to JSON file.');
    });

    importJsonBtn.addEventListener('click', () => {
        if (importJsonInput.files.length === 0) {
            alert('Please select a JSON file to import.');
            return;
        }
        const file = importJsonInput.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedSetup = JSON.parse(event.target.result);
                if (!importedSetup.banners || !Array.isArray(importedSetup.banners) || !importedSetup.lastModified) {
                    alert('Invalid JSON format. Expected "banners" array and "lastModified" timestamp.');
                    return;
                }

                const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
                
                const baseFilename = getFilenameWithoutExtension(file.name);
                const displayName = `${baseFilename} (${new Date(importedSetup.lastModified).toLocaleString()})`;
                let storageKey = `FILEIMPORT_${baseFilename.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                let counter = 1;
                const originalStorageKey = storageKey;
                while(allSetups[`${storageKey}${counter > 1 ? '_'+counter : ''}`]) {
                    counter++;
                }
                storageKey = `${storageKey}${counter > 1 ? '_'+counter : ''}`;


                allSetups[storageKey] = {
                    displayName: displayName,
                    originalFilename: file.name, 
                    lastModified: importedSetup.lastModified, 
                    data: importedSetup.banners
                };
                localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allSetups));
                
                applyState(importedSetup.banners); 
                saveSetupNameInput.value = baseFilename; 
                listSavedSetups(); 
                loadSetupSelect.value = storageKey; 

                alert(`Setup from "${file.name}" imported as "${displayName}" and loaded.`);
            } catch (error) {
                console.error('Error importing JSON:', error);
                alert(`Error importing JSON: ${error.message}`);
            } finally {
                importJsonInput.value = ''; 
            }
        };
        reader.readAsText(file);
    });

    // --- DATA COLLECTION FOR RESULTS PAGE (Attached to both .proceed-button elements) ---
    calculateBtnLinks.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const dataForAllBanners = banners.map(bannerData => {
                const singleUnitAnalyses = bannerData.units.map(u => ({ bannerName: bannerData.name, name: u.name, type: "single_unit", unitId: u.id }));
                const customGroupAnalyses = (bannerData.customAnalyses || []).map(cg => ({
                    bannerName: bannerData.name, name: cg.name, type: "custom_group", 
                    constituents: (cg.constituents || []).filter(c => c.unitId) 
                })).filter(cg => cg.constituents && cg.constituents.length > 0);
                return {
                    bannerId: bannerData.id, bannerName: bannerData.name, totalMultis: bannerData.totalMultis,
                    units: bannerData.units, stepDefinitions: bannerData.steps, 
                    analysesToPerformOnResultsPage: [...singleUnitAnalyses, ...customGroupAnalyses]
                };
            }).filter(b => b.analysesToPerformOnResultsPage.length > 0);

            if (dataForAllBanners.length === 0) { 
                alert("No units or custom analysis groups are defined in any banner. Please add some to proceed."); 
                e.preventDefault(); // Prevent navigation
                return; 
            }
            
            const lastCalculatedSetup = {
                lastModified: getCurrentTimestamp(),
                data: getCurrentState() 
            };
            localStorage.setItem(LAST_CALCULATED_STATE_KEY, JSON.stringify(lastCalculatedSetup)); 
            localStorage.setItem('sugofestCalcSetup', JSON.stringify({ allBannerData: dataForAllBanners }));
        });
    });


    // --- AUTO-LOAD & INITIALIZATION ---
    async function initializePage() {
        await fetchAndLoadServerSetups(); 
        listSavedSetups(); 

        const urlParams = new URLSearchParams(window.location.search);
        let stateLoaded = false;

        if (urlParams.has('autoLoadLast')) {
            const lastStateJSON = localStorage.getItem(LAST_CALCULATED_STATE_KEY);
            if (lastStateJSON) {
                try {
                    const stateToLoad = JSON.parse(lastStateJSON);
                    if (stateToLoad && stateToLoad.data && Array.isArray(stateToLoad.data)) {
                        applyState(stateToLoad.data);
                        console.log("Auto-loaded last calculated state (due to query param).");
                        if (window.history.replaceState) {
                            const cleanURL = window.location.protocol + "//" + window.location.host + window.location.pathname;
                            window.history.replaceState({ path: cleanURL }, '', cleanURL);
                        }
                        stateLoaded = true;
                    }
                } catch (e) { console.error("Error parsing auto-load state:", e); }
            }
        }

        if (!stateLoaded && loadSetupSelect.options.length > 1) { 
            const firstSetupKey = loadSetupSelect.options[1].value; 
            const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
            const setupToLoad = allSetups[firstSetupKey];

            if (setupToLoad && (setupToLoad.data || Array.isArray(setupToLoad))) {
                applyState(setupToLoad.data || setupToLoad);
                saveSetupNameInput.value = firstSetupKey.startsWith("AUTOLOAD_") || firstSetupKey.startsWith("FILEIMPORT_") ? 
                                            getFilenameWithoutExtension(setupToLoad.originalFilename || firstSetupKey) : firstSetupKey;
                loadSetupSelect.value = firstSetupKey;
                console.log(`Auto-loaded most recent setup: "${setupToLoad.displayName || firstSetupKey}"`);
                stateLoaded = true;
            }
        }
        
        if (!stateLoaded) { 
             const lastCalculatedStateJSON = localStorage.getItem(LAST_CALCULATED_STATE_KEY);
             if (lastCalculatedStateJSON) {
                 try {
                     const stateToLoad = JSON.parse(lastCalculatedStateJSON);
                     if (stateToLoad && stateToLoad.data && Array.isArray(stateToLoad.data)) {
                         applyState(stateToLoad.data);
                         console.log("Loaded from last calculated state (fallback).");
                         stateLoaded = true;
                     }
                 } catch (e) { console.error("Error parsing last calculated state (fallback):", e); }
             }
        }

        if (!stateLoaded) { 
            console.log("No saved state found, initializing with a default banner.");
            addBanner(null);
        }
    }
    
    initializePage();
});