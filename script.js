document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const bannerTabsContainer = document.getElementById('bannerTabsContainer');
    const activeBannerContent = document.getElementById('activeBannerContent');
    const addBannerBtn = document.getElementById('addBannerBtn');
    const renameBannerInput = document.getElementById('renameBannerInput');
    const renameBannerBtn = document.getElementById('renameBannerBtn');
    const deleteBannerBtn = document.getElementById('deleteBannerBtn');
    
    const calculateBtnLink = document.getElementById('calculateBtnLink');
    const saveSetupNameInput = document.getElementById('saveSetupName');
    const saveNamedStateBtn = document.getElementById('saveNamedStateBtn');
    const loadSetupSelect = document.getElementById('loadSetupSelect');
    const loadNamedStateBtn = document.getElementById('loadNamedStateBtn');
    const deleteNamedStateBtn = document.getElementById('deleteNamedStateBtn');

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
    let globalDefaultUnitNameCounter = 0; // For unique default unit names across all banners if needed
    const SAVED_SETUPS_KEY = 'sugofestMultiBannerSetups';
    const LAST_CALCULATED_STATE_KEY = '__last_calculated_banner_state__';


    // --- UTILITY ---
    function generateUniqueId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // --- STEP & UNIT DISPLAY UPDATES ---
    function updateStepNumbersAndDisplays() {
        if (!activeBannerId || !activeBannerContent.querySelector('.banner-data-container')) return;

        const currentBannerStepsContainer = activeBannerContent.querySelector('.steps-definition-container');
        if (!currentBannerStepsContainer) return;

        const globalStepBlocks = currentBannerStepsContainer.querySelectorAll('.step-definition-block');
        globalStepBlocks.forEach((gsBlock, index) => {
            gsBlock.querySelector('.step-number').textContent = index + 1;
            // gsBlock.dataset.stepDefIndex = index; // Redundant if stepData.id is used

            const currentBannerUnitsContainer = activeBannerContent.querySelector('.units-container');
            if (!currentBannerUnitsContainer) return;
            currentBannerUnitsContainer.querySelectorAll('.unit-block').forEach(unitBlock => {
                // Find step-rate-entry by stepData.id (more robust)
                const stepDataId = gsBlock.dataset.stepId;
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
            // Ensure unique default names within THIS banner
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
        const entryElement = entryInstance.firstElementChild; // Get the actual <div class="unit-step-rate-entry...">
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

        const container = activeBannerContent.querySelector('.steps-definition-container');
        if (container) {
            renderStepDefinition(container, newStepData, currentBanner.units);
        }
        // New step requires adding rate entries to all existing units in this banner
        const unitsContainerInBanner = activeBannerContent.querySelector('.units-container');
        if (unitsContainerInBanner) {
             unitsContainerInBanner.querySelectorAll('.unit-block').forEach(unitBlockDOM => {
                const unitId = unitBlockDOM.dataset.unitId;
                const unitInModel = currentBanner.units.find(u => u.id === unitId);
                if (unitInModel && !unitBlockDOM.querySelector(`.unit-step-rate-entry[data-step-ref-id="${newStepData.id}"]`)) {
                    // Find the visual index for the new step
                    const visualIndex = Array.from(container.children).length -1; // current length - 1 if just added
                     addUnitStepRateEntryToUnit(unitBlockDOM, newStepData, visualIndex, null, unitInModel.universalBaseRate);
                }
            });
        }
         updateStepNumbersAndDisplays(); // After all DOM changes
    }

    // --- UI RENDERING for current active banner ---
    function renderStepDefinition(container, stepData, unitsInBanner) {
        const stepInstance = stepDefinitionTemplate.content.cloneNode(true);
        const blockElement = stepInstance.firstElementChild; // Get the <div class="step-definition-block item-block">
        blockElement.dataset.stepId = stepData.id;
        blockElement.querySelector('.step-multis').value = Array.isArray(stepData.appliesToMultis) ? stepData.appliesToMultis.join(',') : '';
        blockElement.querySelector('.step-gem-cost').value = stepData.gemCost;
        container.appendChild(blockElement);
        // updateStepNumbersAndDisplays is called after all steps are rendered or after add/remove
    }

     function renderUnit(container, unitData, stepsInBanner) {
        const unitInstance = unitTemplate.content.cloneNode(true);
        const blockElement = unitInstance.firstElementChild; // Get <div class="unit-block item-block">
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

        const container = activeBannerContent.querySelector('.analysis-targets-container');
        if(container) renderAnalysisTarget(container, newAnalysisData, currentBanner.units);
    }
    
    function renderAnalysisTarget(container, analysisData, unitsInBanner) {
        const instance = analysisTargetTemplate.content.cloneNode(true);
        const blockElement = instance.firstElementChild; // Get <div class="analysis-target-block item-block">
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
        if (currentBanner.units.length > 0) newConstituentData.unitId = currentBanner.units[0].id; // Default
        analysisInModel.constituents.push(newConstituentData);

        const container = parentAnalysisBlockDOM.querySelector('.constituent-units-container');
        renderConstituentUnit(container, newConstituentData, currentBanner.units, analysisId);
    }
    
    function renderConstituentUnit(container, constituentData, unitsInBanner, parentAnalysisId) {
        const instance = constituentUnitTemplate.content.cloneNode(true);
        const entryElement = instance.firstElementChild; // Get <div class="constituent-unit-entry...">
        entryElement.dataset.constituentId = constituentData.id;
        entryElement.dataset.parentAnalysisId = parentAnalysisId;

        const unitSelect = entryElement.querySelector('.constituent-unit-select');
        const multiplierInput = entryElement.querySelector('.constituent-unit-multiplier');

        populateUnitDropdownForAnalysis(unitSelect, unitsInBanner, constituentData.unitId);
        // Sync model with UI state immediately, especially if a default was chosen
        constituentData.unitId = unitSelect.value; 
        multiplierInput.value = constituentData.multiplier;
        container.appendChild(entryElement);
    }

    function populateUnitDropdownForAnalysis(selectElement, unitsInBanner, desiredValue = null) { /* ... as before ... */
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
    
    function updateAllAnalysisConstituentUnitDropdowns() { /* ... as before, ensures model is updated ... */
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
        // Ensure all IDs are present when loading
        if (bannerToLoad) {
            newBannerData.steps.forEach(s => s.id = s.id || generateUniqueId('step'));
            newBannerData.units.forEach(u => u.id = u.id || generateUniqueId('unit'));
            newBannerData.customAnalyses.forEach(a => {
                a.id = a.id || generateUniqueId('analysis');
                if(a.constituents) a.constituents.forEach(c => c.id = c.id || generateUniqueId('constituent'));
            });
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
        const dataContainer = bannerInstance.firstElementChild; // Get the <div class="banner-data-container">
        dataContainer.dataset.bannerId = bannerData.id; 

        dataContainer.querySelector('.total-multis-input').value = bannerData.totalMultis;
        
        const stepsContainer = dataContainer.querySelector('.steps-definition-container');
        stepsContainer.innerHTML = ''; 
        bannerData.steps.forEach(step => renderStepDefinition(stepsContainer, step, bannerData.units));

        const unitsContainerElement = dataContainer.querySelector('.units-container');
        unitsContainerElement.innerHTML = '';
        bannerData.units.forEach(unit => renderUnit(unitsContainerElement, unit, bannerData.steps));
        
        const analysesContainer = dataContainer.querySelector('.analysis-targets-container');
        analysesContainer.innerHTML = '';
        if (bannerData.customAnalyses) { // Ensure customAnalyses exists
            bannerData.customAnalyses.forEach(analysis => renderAnalysisTarget(analysesContainer, analysis, bannerData.units));
        } else {
            bannerData.customAnalyses = []; // Initialize if missing
        }
        activeBannerContent.appendChild(dataContainer);
        updateStepNumbersAndDisplays(); // Crucial after rendering all steps
    }

    function deleteActiveBanner() { /* ... as before ... */ 
        if (!activeBannerId || banners.length <= 1) { alert("Cannot delete the last banner."); return; }
        const bannerToDelete = findBannerById(activeBannerId);
        if (!confirm(`Delete banner "${bannerToDelete.name}"?`)) return;
        banners = banners.filter(b => b.id !== activeBannerId);
        activeBannerId = banners.length > 0 ? banners[0].id : null;
        renderBannerTabs();
        if (activeBannerId) setActiveBanner(activeBannerId);
        else activeBannerContent.innerHTML = '<p>No active banner.</p>';
    }
    function renameActiveBanner() { /* ... as before ... */ 
        if (!activeBannerId) return;
        const newName = renameBannerInput.value.trim();
        if (!newName) { alert("Banner name cannot be empty."); return; }
        const banner = findBannerById(activeBannerId);
        if (banner) { banner.name = newName; renderBannerTabs(); }
    }
    function findBannerById(id) { return banners.find(b => b.id === id); }
    function renderBannerTabs() { /* ... as before ... */ 
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
    addBannerBtn.addEventListener('click', () => addBanner(null)); // Pass null for new banner
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
            stepBlock.remove(); // Remove the item-block itself
            updateUnitStepRateDisplaysForBanner(currentBanner.units, currentBanner.steps);
            updateStepNumbersAndDisplays();
        }
        if (e.target.matches('.add-unit-btn')) createNewUnitForActiveBanner(null);
        if (e.target.matches('.unit-block .remove-item-btn')) { /* ... (updated in previousthought, ensure correct element removal) ... */
            const unitBlock = e.target.closest('.unit-block');
            const unitId = unitBlock.dataset.unitId;
            currentBanner.units = currentBanner.units.filter(u => u.id !== unitId);
            currentBanner.customAnalyses.forEach(analysis => {
                analysis.constituents = analysis.constituents.filter(c => c.unitId !== unitId);
                 const analysisBlockDOM = activeBannerContent.querySelector(`.analysis-target-block[data-analysis-id="${analysis.id}"]`);
                if (analysisBlockDOM) { /* ... re-render constituents ... */ 
                    const constituentsContainer = analysisBlockDOM.querySelector('.constituent-units-container');
                    constituentsContainer.innerHTML = ''; // Clear and re-render
                    analysis.constituents.forEach(c => renderConstituentUnit(constituentsContainer, c, currentBanner.units, analysis.id));
                }
            });
            unitBlock.remove(); 
            updateAllAnalysisConstituentUnitDropdowns();
        }
        if (e.target.matches('.unit-block .use-base-rate-btn')) { /* ... as before ... */ 
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
        if (e.target.matches('.analysis-target-block .remove-item-btn')) { /* ... as before ... */
            const analysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = analysisBlock.dataset.analysisId;
            currentBanner.customAnalyses = currentBanner.customAnalyses.filter(a => a.id !== analysisId);
            analysisBlock.remove();
        }
        if (e.target.matches('.analysis-target-block .add-constituent-unit-btn')) {
            const parentAnalysisBlockDOM = e.target.closest('.analysis-target-block');
            addConstituentUnitToGroupUI(parentAnalysisBlockDOM);
        }
        if (e.target.matches('.constituent-unit-entry .remove-constituent-btn')) { /* ... as before ... */
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

    activeBannerContent.addEventListener('change', (e) => { /* ... (as before, ensures model updates) ... */ 
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;
        if (e.target.matches('.total-multis-input')) currentBanner.totalMultis = parseInt(e.target.value) || 30;
        const stepBlock = e.target.closest('.step-definition-block');
        if (stepBlock) { /* ... update currentBanner.steps[stepId] ... */ 
            const stepId = stepBlock.dataset.stepId;
            const stepData = currentBanner.steps.find(s => s.id === stepId);
            if(stepData){
                if (e.target.matches('.step-multis')) {
                    stepData.appliesToMultis = e.target.value.split(',').map(s=>s.trim()).filter(Boolean).map(Number);
                    updateUnitStepRateDisplaysForBanner(currentBanner.units, currentBanner.steps);
                } else if (e.target.matches('.step-gem-cost')) stepData.gemCost = parseInt(e.target.value) || 50;
            }
        }
        const unitBlock = e.target.closest('.unit-block');
        if (unitBlock) { /* ... update currentBanner.units[unitId] ... */ 
            const unitId = unitBlock.dataset.unitId;
            const unitData = currentBanner.units.find(u => u.id === unitId);
            if(unitData){
                if (e.target.matches('.unit-name')) { unitData.name = e.target.value; updateAllAnalysisConstituentUnitDropdowns(); } 
                else if (e.target.matches('.unit-universal-base-rate')) unitData.universalBaseRate = e.target.value;
            }
        }
        const unitStepRateEntry = e.target.closest('.unit-step-rate-entry');
        if (unitStepRateEntry) { /* ... update currentBanner.units[unitId].stepOverrides ... */ 
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
        if (analysisBlock) { /* ... update currentBanner.customAnalyses[analysisId].name ... */ 
            const analysisId = analysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            if (analysisData && e.target.matches('.analysis-name')) analysisData.name = e.target.value;
        }
        const constituentEntry = e.target.closest('.constituent-unit-entry');
        if (constituentEntry) { /* ... update currentBanner.customAnalyses[analysisId].constituents[constituentId] ... */ 
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

    // --- NAMED SAVE/LOAD STATE --- (as before, uses getCurrentState and applyState)
    function listSavedSetups() { /* ... as before ... */ 
        loadSetupSelect.innerHTML = '<option value="">-- Select a saved setup --</option>';
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        Object.keys(allSetups).sort().forEach(name => { loadSetupSelect.add(new Option(name, name)); });
    }
    saveNamedStateBtn.addEventListener('click', () => { /* ... as before, saves `banners` array ... */ 
        const name = saveSetupNameInput.value.trim();
        if (!name) { alert('Please enter a name.'); return; }
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        allSetups[name] = banners; // `banners` should be up-to-date
        localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allSetups));
        alert(`Setup "${name}" saved!`); listSavedSetups(); loadSetupSelect.value = name;
    });
    loadNamedStateBtn.addEventListener('click', () => { /* Uses applyState */ 
        const name = loadSetupSelect.value;
        if (!name) { alert('Please select a setup.'); return; }
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        const stateToLoad = allSetups[name]; // This is the banners array
        if (!stateToLoad || !Array.isArray(stateToLoad)) { alert(`Setup "${name}" invalid.`); return; }
        applyState(stateToLoad); 
        saveSetupNameInput.value = name; alert(`Setup "${name}" loaded!`);
    });
    deleteNamedStateBtn.addEventListener('click', () => { /* ... as before ... */ 
        const name = loadSetupSelect.value; if (!name) { alert('Select setup.'); return; }
        if (!confirm(`Delete "${name}"?`)) return;
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        delete allSetups[name]; localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allSetups));
        alert(`"${name}" deleted.`); listSavedSetups(); saveSetupNameInput.value = '';
    });
    
    function getCurrentState() { /* Should just return the `banners` array, assuming it's kept in sync */
        return banners; // Or deep clone: JSON.parse(JSON.stringify(banners));
    }

    function applyState(bannersToLoad) { // Parameter is the array of banner objects
        banners = []; activeBannerId = null; activeBannerContent.innerHTML = ''; globalDefaultUnitNameCounter = 0;
        
        // Create data models first
        bannersToLoad.forEach(bannerData => {
            const bannerId = bannerData.id || generateUniqueId('banner');
            const loadedBanner = {
                id: bannerId,
                name: bannerData.name || `Banner ${banners.length + 1}`,
                totalMultis: bannerData.totalMultis || 30,
                steps: (bannerData.steps || []).map(s => ({...s, id: s.id || generateUniqueId('step')}) ),
                units: (bannerData.units || []).map(u => ({...u, id: u.id || generateUniqueId('unit')}) ),
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
            setActiveBanner(banners[0].id); // This will call populateBannerContent
        } else {
            activeBannerContent.innerHTML = '<p>Loaded setup is empty or invalid.</p>';
        }
    }

    // --- DATA COLLECTION FOR RESULTS PAGE ---
    calculateBtnLink.addEventListener('click', () => { /* ... as before ... */ 
        const dataForAllBanners = banners.map(bannerData => {
            const singleUnitAnalyses = bannerData.units.map(u => ({ bannerName: bannerData.name, name: u.name, type: "single_unit", unitId: u.id }));
            const customGroupAnalyses = bannerData.customAnalyses.map(cg => ({
                bannerName: bannerData.name, name: cg.name, type: "custom_group", 
                constituents: cg.constituents.filter(c => c.unitId) 
            })).filter(cg => cg.constituents.length > 0);
            return {
                bannerId: bannerData.id, bannerName: bannerData.name, totalMultis: bannerData.totalMultis,
                units: bannerData.units, stepDefinitions: bannerData.steps, 
                analysesToPerformOnResultsPage: [...singleUnitAnalyses, ...customGroupAnalyses]
            };
        }).filter(b => b.analysesToPerformOnResultsPage.length > 0);
        if (dataForAllBanners.length === 0) { alert("No units/analyses defined."); return; }
        localStorage.setItem(LAST_CALCULATED_STATE_KEY, JSON.stringify(banners)); 
        localStorage.setItem('sugofestCalcSetup', JSON.stringify({ allBannerData: dataForAllBanners }));
    });

    // --- AUTO-LOAD & INITIALIZATION ---
    function autoLoadLastCalculatedState() { /* Uses applyState */ 
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('autoLoadLast')) {
            const lastStateJSON = localStorage.getItem(LAST_CALCULATED_STATE_KEY);
            if (lastStateJSON) {
                try {
                    const stateToLoad = JSON.parse(lastStateJSON); // This is the `banners` array
                    if (Array.isArray(stateToLoad)) { // No need for stateToLoad.length > 0 check here, applyState handles empty
                        applyState(stateToLoad); // applyState will clear current and load
                        console.log("Auto-loaded last calculated state.");
                         if (window.history.replaceState) { /* ... clean URL ... */ 
                            const cleanURL = window.location.protocol + "//" + window.location.host + window.location.pathname;
                            window.history.replaceState({ path: cleanURL }, '', cleanURL);
                         }
                        return true; // Indicates state was loaded
                    }
                } catch (e) { console.error("Error parsing auto-load state:", e); }
            }
        }
        return false; // No state loaded
    }

    listSavedSetups(); 
    const loaded = autoLoadLastCalculatedState(); 
    if (!loaded && banners.length === 0) { 
        addBanner(null); // Add one default banner if nothing loaded and banners array is empty
    } else if (banners.length > 0 && !activeBannerId) { // Should be handled by applyState or addBanner
        setActiveBanner(banners[0].id);
    }
});