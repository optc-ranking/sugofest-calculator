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
    let banners = []; // Array of banner objects { id, name, totalMultis, steps, units, analyses }
    let activeBannerId = null;
    let defaultUnitNameCounter = 0;
    const SAVED_SETUPS_KEY = 'sugofestMultiBannerSetups';
    const LAST_CALCULATED_STATE_KEY = '__last_calculated_banner_state__';


    // --- UTILITY ---
    function generateUniqueId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // --- BANNER MANAGEMENT ---
    function addBanner(bannerToLoad = null) {
        defaultUnitNameCounter = 0; // Reset for new banner context if not loading
        const bannerId = bannerToLoad ? bannerToLoad.id : generateUniqueId('banner');
        const bannerName = bannerToLoad ? bannerToLoad.name : `Banner ${banners.length + 1}`;
        
        const newBannerData = bannerToLoad || {
            id: bannerId,
            name: bannerName,
            totalMultis: 30,
            steps: [],
            units: [],
            customAnalyses: [] // Renamed from 'analyses' to avoid conflict
        };
        banners.push(newBannerData);
        renderBannerTabs();
        setActiveBanner(bannerId);

        if (bannerToLoad) { // If loading, populate content
            populateBannerContent(newBannerData);
        } else { // If new, create default step and unit
            const bannerData = findBannerById(bannerId);
            if (bannerData) {
                 // Add default elements *to the bannerData object first*
                const defaultStep = { id: generateUniqueId('step'), appliesToMultis: [], gemCost: 50 };
                bannerData.steps.push(defaultStep);
                
                const defaultUnit = { 
                    id: generateUniqueId('unit'), 
                    name: `Unit ${++defaultUnitNameCounter}`, 
                    universalBaseRate: "0.500", 
                    stepOverrides: [] 
                };
                bannerData.units.push(defaultUnit);
                populateBannerContent(bannerData); // Then render
            }
        }
        return bannerId;
    }

    function setActiveBanner(bannerId) {
        activeBannerId = bannerId;
        const bannerData = findBannerById(bannerId);
        if (bannerData) {
            populateBannerContent(bannerData);
            renameBannerInput.value = bannerData.name;
        }
        renderBannerTabs(); // To highlight active tab
    }

    function deleteActiveBanner() {
        if (!activeBannerId || banners.length <= 1) {
            alert("Cannot delete the last banner.");
            return;
        }
        if (!confirm(`Are you sure you want to delete banner "${findBannerById(activeBannerId).name}"?`)) return;

        banners = banners.filter(b => b.id !== activeBannerId);
        activeBannerId = banners.length > 0 ? banners[0].id : null;
        renderBannerTabs();
        if (activeBannerId) setActiveBanner(activeBannerId);
        else activeBannerContent.innerHTML = '<p>No active banner. Please add one.</p>';
    }

    function renameActiveBanner() {
        if (!activeBannerId) return;
        const newName = renameBannerInput.value.trim();
        if (!newName) {
            alert("Banner name cannot be empty.");
            return;
        }
        const banner = findBannerById(activeBannerId);
        if (banner) {
            banner.name = newName;
            renderBannerTabs();
        }
    }

    function findBannerById(id) {
        return banners.find(b => b.id === id);
    }

    // --- UI RENDERING ---
    function renderBannerTabs() {
        bannerTabsContainer.innerHTML = '';
        banners.forEach(banner => {
            const tab = document.createElement('div');
            tab.className = 'banner-tab';
            tab.textContent = banner.name;
            tab.dataset.bannerId = banner.id;
            if (banner.id === activeBannerId) {
                tab.classList.add('active');
            }
            tab.addEventListener('click', () => setActiveBanner(banner.id));
            bannerTabsContainer.appendChild(tab);
        });
    }

    function populateBannerContent(bannerData) {
        if (!bannerData) {
            activeBannerContent.innerHTML = '<p>Error: Banner data not found.</p>';
            return;
        }
        activeBannerContent.innerHTML = ''; // Clear previous
        const bannerInstance = bannerContentTemplate.content.cloneNode(true);
        const dataContainer = bannerInstance.querySelector('.banner-data-container');
        dataContainer.dataset.bannerId = bannerData.id; // Link content to banner

        // Populate fields for this banner
        dataContainer.querySelector('.total-multis-input').value = bannerData.totalMultis;
        
        const stepsContainer = dataContainer.querySelector('.steps-definition-container');
        stepsContainer.innerHTML = ''; // Clear for re-population
        bannerData.steps.forEach(step => renderStepDefinition(stepsContainer, step, bannerData.units));

        const unitsContainerElement = dataContainer.querySelector('.units-container');
        unitsContainerElement.innerHTML = '';
        bannerData.units.forEach(unit => renderUnit(unitsContainerElement, unit, bannerData.steps));
        
        const analysesContainer = dataContainer.querySelector('.analysis-targets-container');
        analysesContainer.innerHTML = '';
        bannerData.customAnalyses.forEach(analysis => renderAnalysisTarget(analysesContainer, analysis, bannerData.units));

        activeBannerContent.appendChild(bannerInstance);
        updateAllUnitDropdownsInActiveBanner(); // For custom analyses
    }
    
    // --- Element Rendering (within active banner) ---
    // These functions now operate on and modify the bannerData object for the active banner.

    function renderStepDefinition(container, stepData, unitsInBanner) {
        const stepInstance = stepDefinitionTemplate.content.cloneNode(true);
        const block = stepInstance.querySelector('.step-definition-block');
        block.dataset.stepId = stepData.id;
        block.querySelector('.step-number').textContent = container.children.length + 1; // Visual
        block.querySelector('.step-multis').value = stepData.appliesToMultis.join(',');
        block.querySelector('.step-gem-cost').value = stepData.gemCost;
        container.appendChild(stepInstance);
        // Update unit step rate displays for all units in this banner
        updateUnitStepRateDisplaysForBanner(unitsInBanner, findBannerById(activeBannerId).steps);
    }

    function renderUnit(container, unitData, stepsInBanner) {
        const unitInstance = unitTemplate.content.cloneNode(true);
        const block = unitInstance.querySelector('.unit-block');
        block.dataset.unitId = unitData.id;
        block.querySelector('.unit-name').value = unitData.name;
        block.querySelector('.unit-universal-base-rate').value = unitData.universalBaseRate;
        
        const ratesContainer = block.querySelector('.unit-steps-rates-container');
        stepsInBanner.forEach((step, index) => {
            const override = unitData.stepOverrides.find(so => so.globalStepDefId === step.id);
            renderUnitStepRateEntry(ratesContainer, step, index, override, unitData.universalBaseRate);
        });
        container.appendChild(unitInstance);
    }
    
    function renderUnitStepRateEntry(container, stepData, stepVisualIndex, overrideData, universalRate) {
        const entryInstance = unitStepRateTemplate.content.cloneNode(true);
        const entryDiv = entryInstance.querySelector('.unit-step-rate-entry');
        entryDiv.dataset.stepRefId = stepData.id; // Link to the global step ID
        entryDiv.querySelector('.unit-step-number-display').textContent = stepVisualIndex + 1;
        entryDiv.querySelector('.unit-step-multis-display').textContent = stepData.appliesToMultis.join(',') || 'N/A';
        
        const baseRateInput = entryDiv.querySelector('.unit-step-base-rate');
        const finalPosterRateInput = entryDiv.querySelector('.unit-step-final-poster-rate');
        if (overrideData) {
            baseRateInput.value = overrideData.baseRate10Pulls;
            finalPosterRateInput.value = overrideData.finalPosterRate;
        } else {
            baseRateInput.value = universalRate;
            finalPosterRateInput.value = universalRate;
        }
        container.appendChild(entryInstance);
    }

    function renderAnalysisTarget(container, analysisData, unitsInBanner) {
        const instance = analysisTargetTemplate.content.cloneNode(true);
        const block = instance.querySelector('.analysis-target-block');
        block.dataset.analysisId = analysisData.id;
        block.querySelector('.analysis-name').value = analysisData.name;
        const constituentsContainer = block.querySelector('.constituent-units-container');
        analysisData.constituents.forEach(c => renderConstituentUnit(constituentsContainer, c, unitsInBanner));
        container.appendChild(instance);
    }

    function renderConstituentUnit(container, constituentData, unitsInBanner) {
        const instance = constituentUnitTemplate.content.cloneNode(true);
        const entry = instance.querySelector('.constituent-unit-entry');
        entry.dataset.constituentId = constituentData.id;
        const unitSelect = entry.querySelector('.constituent-unit-select');
        populateUnitDropdownForAnalysis(unitSelect, unitsInBanner, constituentData.unitId);
        entry.querySelector('.constituent-unit-multiplier').value = constituentData.multiplier;
        container.appendChild(instance);
    }

    function populateUnitDropdownForAnalysis(selectElement, unitsInBanner, selectedValue = null) {
        selectElement.innerHTML = '';
        if (!unitsInBanner || unitsInBanner.length === 0) {
            selectElement.add(new Option("No units in banner", "", true, true));
            return;
        }
        unitsInBanner.forEach(unit => {
            selectElement.add(new Option(unit.name || `Unnamed (ID: ${unit.id.substr(0,5)})`, unit.id));
        });
        if (selectedValue) selectElement.value = selectedValue;
        else if (unitsInBanner.length > 0) selectElement.value = unitsInBanner[0].id; // Default to first
    }
    
    function updateAllUnitDropdownsInActiveBanner() {
        const activeBannerData = findBannerById(activeBannerId);
        if (!activeBannerData || !activeBannerContent.querySelector('.banner-data-container')) return;

        activeBannerContent.querySelectorAll('.analysis-target-block').forEach(analysisBlock => {
            analysisBlock.querySelectorAll('.constituent-unit-select').forEach(select => {
                populateUnitDropdownForAnalysis(select, activeBannerData.units, select.value);
            });
        });
    }
    
    function updateUnitStepRateDisplaysForBanner(unitsInBanner, stepsInBanner) {
        const activeBannerDiv = activeBannerContent.querySelector(`.banner-data-container[data-banner-id="${activeBannerId}"]`);
        if (!activeBannerDiv) return;

        unitsInBanner.forEach(unitData => {
            const unitBlock = activeBannerDiv.querySelector(`.unit-block[data-unit-id="${unitData.id}"]`);
            if (!unitBlock) return;
            const ratesContainer = unitBlock.querySelector('.unit-steps-rates-container');
            ratesContainer.innerHTML = ''; // Clear and re-render all step rate entries for this unit
            stepsInBanner.forEach((step, index) => {
                 const override = unitData.stepOverrides.find(so => so.globalStepDefId === step.id);
                 renderUnitStepRateEntry(ratesContainer, step, index, override, unitData.universalBaseRate);
            });
        });
    }


    // --- EVENT HANDLERS (Delegated from activeBannerContent or document.body) ---
    activeBannerContent.addEventListener('click', (e) => {
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;

        // Add Step
        if (e.target.matches('.add-step-btn')) {
            const newStep = { id: generateUniqueId('step'), appliesToMultis: [], gemCost: 50 };
            currentBanner.steps.push(newStep);
            const container = activeBannerContent.querySelector('.steps-definition-container');
            renderStepDefinition(container, newStep, currentBanner.units);
            updateUnitStepRateDisplaysForBanner(currentBanner.units, currentBanner.steps);
        }
        // Remove Step
        if (e.target.matches('.step-definition-block .remove-item-btn')) {
            const stepBlock = e.target.closest('.step-definition-block');
            const stepId = stepBlock.dataset.stepId;
            currentBanner.steps = currentBanner.steps.filter(s => s.id !== stepId);
            // Also remove overrides for this step from all units in this banner
            currentBanner.units.forEach(u => {
                u.stepOverrides = u.stepOverrides.filter(so => so.globalStepDefId !== stepId);
            });
            stepBlock.remove();
            updateUnitStepRateDisplaysForBanner(currentBanner.units, currentBanner.steps);
            // Re-number visual step numbers
            const remainingStepBlocks = activeBannerContent.querySelectorAll('.step-definition-block');
            remainingStepBlocks.forEach((block, index) => block.querySelector('.step-number').textContent = index + 1);
        }
        // Add Unit
        if (e.target.matches('.add-unit-btn')) {
            defaultUnitNameCounter++;
            const newUnit = { 
                id: generateUniqueId('unit'), 
                name: `Unit ${defaultUnitNameCounter}`, 
                universalBaseRate: "0.500", 
                stepOverrides: [] 
            };
            currentBanner.units.push(newUnit);
            const container = activeBannerContent.querySelector('.units-container');
            renderUnit(container, newUnit, currentBanner.steps);
            updateAllUnitDropdownsInActiveBanner();
        }
        // Remove Unit
        if (e.target.matches('.unit-block .remove-item-btn')) {
            const unitBlock = e.target.closest('.unit-block');
            const unitId = unitBlock.dataset.unitId;
            currentBanner.units = currentBanner.units.filter(u => u.id !== unitId);
            // Also remove this unit from any custom analyses in this banner
            currentBanner.customAnalyses.forEach(analysis => {
                analysis.constituents = analysis.constituents.filter(c => c.unitId !== unitId);
            });
            unitBlock.remove();
            updateAllUnitDropdownsInActiveBanner();
            // Re-render custom analyses if units changed
            const analysesContainer = activeBannerContent.querySelector('.analysis-targets-container');
            analysesContainer.innerHTML = '';
            currentBanner.customAnalyses.forEach(analysis => renderAnalysisTarget(analysesContainer, analysis, currentBanner.units));
        }
        // Use Universal Rate for Unit
        if (e.target.matches('.unit-block .use-base-rate-btn')) {
            const unitBlock = e.target.closest('.unit-block');
            const unitId = unitBlock.dataset.unitId;
            const unitData = currentBanner.units.find(u => u.id === unitId);
            if (unitData) {
                const universalRate = unitBlock.querySelector('.unit-universal-base-rate').value;
                unitData.universalBaseRate = universalRate; // Save to data
                // Clear existing overrides and re-render with universal
                unitData.stepOverrides = []; 
                const ratesContainer = unitBlock.querySelector('.unit-steps-rates-container');
                ratesContainer.innerHTML = '';
                currentBanner.steps.forEach((step, index) => {
                    renderUnitStepRateEntry(ratesContainer, step, index, null, universalRate);
                });
            }
        }
        // Add Custom Analysis Group
        if (e.target.matches('.add-analysis-target-btn')) {
            const newAnalysis = { id: generateUniqueId('analysis'), name: `Custom Group ${currentBanner.customAnalyses.length + 1}`, constituents: [] };
            currentBanner.customAnalyses.push(newAnalysis);
            const container = activeBannerContent.querySelector('.analysis-targets-container');
            renderAnalysisTarget(container, newAnalysis, currentBanner.units);
        }
        // Remove Custom Analysis Group
        if (e.target.matches('.analysis-target-block .remove-item-btn')) {
            const analysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = analysisBlock.dataset.analysisId;
            currentBanner.customAnalyses = currentBanner.customAnalyses.filter(a => a.id !== analysisId);
            analysisBlock.remove();
        }
        // Add Constituent to Group
        if (e.target.matches('.analysis-target-block .add-constituent-unit-btn')) {
            const analysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = analysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            if (analysisData) {
                const newConstituent = { id: generateUniqueId('constituent'), unitId: null, multiplier: 1 };
                // If there are units, default to the first one
                if (currentBanner.units.length > 0) newConstituent.unitId = currentBanner.units[0].id;
                analysisData.constituents.push(newConstituent);
                const container = analysisBlock.querySelector('.constituent-units-container');
                renderConstituentUnit(container, newConstituent, currentBanner.units);
            }
        }
        // Remove Constituent from Group
        if (e.target.matches('.constituent-unit-entry .remove-constituent-btn')) {
            const constituentEntry = e.target.closest('.constituent-unit-entry');
            const analysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = analysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            if (analysisData) {
                const constituentId = constituentEntry.dataset.constituentId; // Assuming you add this
                analysisData.constituents = analysisData.constituents.filter(c => c.id !== constituentId);
            }
            constituentEntry.remove();
        }
    });

    activeBannerContent.addEventListener('change', (e) => { // For input changes
        const currentBanner = findBannerById(activeBannerId);
        if (!currentBanner) return;

        // Total Multis for banner
        if (e.target.matches('.total-multis-input')) {
            currentBanner.totalMultis = parseInt(e.target.value) || 30;
        }
        // Step definition change
        const stepBlock = e.target.closest('.step-definition-block');
        if (stepBlock) {
            const stepId = stepBlock.dataset.stepId;
            const stepData = currentBanner.steps.find(s => s.id === stepId);
            if (stepData) {
                if (e.target.matches('.step-multis')) {
                    stepData.appliesToMultis = e.target.value.split(',').map(s => s.trim()).filter(Boolean).map(Number);
                    updateUnitStepRateDisplaysForBanner(currentBanner.units, currentBanner.steps);
                } else if (e.target.matches('.step-gem-cost')) {
                    stepData.gemCost = parseInt(e.target.value) || 50;
                }
            }
        }
        // Unit definition change
        const unitBlock = e.target.closest('.unit-block');
        if (unitBlock) {
            const unitId = unitBlock.dataset.unitId;
            const unitData = currentBanner.units.find(u => u.id === unitId);
            if (unitData) {
                if (e.target.matches('.unit-name')) {
                    unitData.name = e.target.value;
                    updateAllAnalysisConstituentUnitDropdowns(); // Reflect name change
                } else if (e.target.matches('.unit-universal-base-rate')) {
                    unitData.universalBaseRate = e.target.value;
                    // If universal rate changes, existing overrides remain, but new ones would use this
                }
            }
        }
        // Unit Step Rate Override Change
        const unitStepRateEntry = e.target.closest('.unit-step-rate-entry');
        if (unitStepRateEntry) {
            const parentUnitBlock = e.target.closest('.unit-block');
            const unitId = parentUnitBlock.dataset.unitId;
            const unitData = currentBanner.units.find(u => u.id === unitId);
            const stepRefId = unitStepRateEntry.dataset.stepRefId;
            if (unitData) {
                let override = unitData.stepOverrides.find(so => so.globalStepDefId === stepRefId);
                if (!override) {
                    override = { globalStepDefId: stepRefId };
                    unitData.stepOverrides.push(override);
                }
                if (e.target.matches('.unit-step-base-rate')) override.baseRate10Pulls = e.target.value;
                if (e.target.matches('.unit-step-final-poster-rate')) override.finalPosterRate = e.target.value;
            }
        }
        // Analysis Group Change
        const analysisBlock = e.target.closest('.analysis-target-block');
        if (analysisBlock) {
            const analysisId = analysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            if (analysisData && e.target.matches('.analysis-name')) {
                analysisData.name = e.target.value;
            }
        }
        // Constituent Unit Change
        const constituentEntry = e.target.closest('.constituent-unit-entry');
        if (constituentEntry) {
            const parentAnalysisBlock = e.target.closest('.analysis-target-block');
            const analysisId = parentAnalysisBlock.dataset.analysisId;
            const analysisData = currentBanner.customAnalyses.find(a => a.id === analysisId);
            const constituentId = constituentEntry.dataset.constituentId; // Need to set this when creating
            const constituent = analysisData ? analysisData.constituents.find(c => c.id === constituentId) : null;
            if (constituent) {
                if (e.target.matches('.constituent-unit-select')) constituent.unitId = e.target.value;
                if (e.target.matches('.constituent-unit-multiplier')) constituent.multiplier = parseInt(e.target.value) || 1;
            }
        }
    });


    // --- BANNER CONTROL BUTTONS ---
    addBannerBtn.addEventListener('click', () => addBanner());
    renameBannerBtn.addEventListener('click', renameActiveBanner);
    deleteBannerBtn.addEventListener('click', deleteActiveBanner);


    // --- NAMED SAVE/LOAD STATE ---
    function listSavedSetups() {
        loadSetupSelect.innerHTML = '<option value="">-- Select a saved setup --</option>';
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        Object.keys(allSetups).sort().forEach(name => {
            loadSetupSelect.add(new Option(name, name));
        });
    }

    saveNamedStateBtn.addEventListener('click', () => {
        const name = saveSetupNameInput.value.trim();
        if (!name) { alert('Please enter a name for this setup.'); return; }
        
        // Important: Ensure current banner's UI data is saved to its object in `banners` array first
        // This might require explicitly calling a function to parse active banner's UI into its object
        // For now, assume data in `banners` array is reasonably up-to-date due to event listeners.
        
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        allSetups[name] = banners; // Save the entire banners array
        localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allSetups));
        alert(`Setup "${name}" saved!`);
        listSavedSetups();
        loadSetupSelect.value = name;
    });

    loadNamedStateBtn.addEventListener('click', () => {
        const name = loadSetupSelect.value;
        if (!name) { alert('Please select a setup to load.'); return; }
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        const bannersToLoad = allSetups[name];
        if (!bannersToLoad) { alert(`Setup "${name}" not found.`); return; }

        banners = []; // Clear current banners
        activeBannerId = null;
        activeBannerContent.innerHTML = ''; // Clear UI for active banner
        
        bannersToLoad.forEach((bannerData, index) => {
            // Add banner will try to create defaults if not loading.
            // We need to pass bannerData directly to avoid this.
            // The addBanner function needs modification to handle this better or a separate loadBanner.
            // For simplicity here, let's reuse addBanner and it will call populateBannerContent.
            if (index === 0) { // For the first banner, ensure it's fully populated
                addBanner(bannerData); // This will set it active and populate
            } else {
                // For subsequent banners, just add their data to the `banners` array.
                // The UI for these will be built when they are switched to.
                const bannerId = bannerData.id || generateUniqueId('banner');
                const loadedBanner = { ...bannerData, id: bannerId }; // Ensure ID
                banners.push(loadedBanner);
            }
        });
        renderBannerTabs();
        if (banners.length > 0) {
            setActiveBanner(banners[0].id); // Set first loaded banner as active
        }
        
        saveSetupNameInput.value = name;
        alert(`Setup "${name}" loaded!`);
    });

    deleteNamedStateBtn.addEventListener('click', () => {
        const name = loadSetupSelect.value;
        if (!name) { alert('Please select a setup to delete.'); return; }
        if (!confirm(`Delete setup "${name}"?`)) return;
        const allSetups = JSON.parse(localStorage.getItem(SAVED_SETUPS_KEY) || '{}');
        delete allSetups[name];
        localStorage.setItem(SAVED_SETUPS_KEY, JSON.stringify(allSetups));
        alert(`Setup "${name}" deleted!`);
        listSavedSetups();
        saveSetupNameInput.value = '';
    });


    // --- DATA COLLECTION FOR RESULTS PAGE ---
    calculateBtnLink.addEventListener('click', () => {
        const dataForAllBanners = banners.map(bannerData => {
            // For each banner, collect its current state from the `bannerData` object
            // Ensure the bannerData object is up-to-date with UI changes before this.
            // This is implicitly handled by the 'change' event listeners updating the objects.
            const singleUnitAnalyses = bannerData.units.map(u => ({
                bannerName: bannerData.name, // Add banner name for results page
                name: u.name,
                type: "single_unit",
                unitId: u.id
            }));
            const customGroupAnalyses = bannerData.customAnalyses.map(cg => ({
                bannerName: bannerData.name, // Add banner name
                ...cg, // Spread the custom group data (name, type="custom_group", constituents)
            }));

            return {
                bannerId: bannerData.id,
                bannerName: bannerData.name,
                totalMultis: bannerData.totalMultis,
                units: bannerData.units, // Base unit definitions for this banner
                stepDefinitions: bannerData.steps, // Step definitions for this banner
                // Analyses for results will combine auto single units and custom groups
                analysesToPerformOnResultsPage: [...singleUnitAnalyses, ...customGroupAnalyses]
            };
        });

        console.log("Data for All Banners (to Results):", JSON.parse(JSON.stringify(dataForAllBanners)));
        localStorage.setItem(LAST_CALCULATED_STATE_KEY, JSON.stringify(banners)); // Save current multi-banner state
        localStorage.setItem('sugofestCalcSetup', JSON.stringify({ allBannerData: dataForAllBanners }));
    });

    // --- AUTO-LOAD LAST CALCULATED STATE ---
    function autoLoadLastCalculatedState() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('autoLoadLast')) {
            const lastStateJSON = localStorage.getItem(LAST_CALCULATED_STATE_KEY);
            if (lastStateJSON) {
                const stateToLoad = JSON.parse(lastStateJSON);
                banners = []; // Clear current state before applying
                activeBannerId = null;
                activeBannerContent.innerHTML = '';

                stateToLoad.forEach((bannerData, index) => {
                     if (index === 0) { 
                        addBanner(bannerData);
                    } else {
                        const bannerId = bannerData.id || generateUniqueId('banner');
                        const loadedBanner = { ...bannerData, id: bannerId }; 
                        banners.push(loadedBanner);
                    }
                });
                renderBannerTabs();
                if (banners.length > 0) setActiveBanner(banners[0].id);

                console.log("Auto-loaded last calculated state.");
                // Optional: remove the temp state after loading
                // localStorage.removeItem(LAST_CALCULATED_STATE_KEY);
                // Optional: clean URL
                // window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    }


    // --- INITIALIZATION ---
    listSavedSetups(); 
    autoLoadLastCalculatedState(); // Check for auto-load trigger
    if (banners.length === 0) { // If auto-load didn't populate, start fresh
        addBanner(); // Start with one default banner
    }
});