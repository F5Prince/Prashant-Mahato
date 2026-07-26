let peopleById = new Map();
let activeRootId = null;
const cardWidth = 220;
const cardHeight = 108;
const horizontalGap = 40;
const verticalGap = 170;
let zoomLevel = 1;
const zoomStep = 0.12;
const minZoom = 0.55;
const maxZoom = 1.8;

function formatName(person) {
  if (!person) return 'Unknown';
  const first = (person.data?.fn || person.data?.['first name'] || '').trim();
  const last = (person.data?.ln || person.data?.['last name'] || '').trim();
  return [first, last].filter(Boolean).join(' ').trim() || 'Unknown';
}

function formatRole(person) {
  const gender = person?.data?.gender;
  if (gender === 'F') return 'Female';
  if (gender === 'M') return 'Male';
  return 'Other';
}

function getInitials(person) {
  const name = formatName(person);
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '•';
}

function getBadgeText(unit) {
  if (unit.spouse) return 'Married';
  if (unit.children.length) return 'Parent';
  return 'Branch';
}

function normalizeFamilyData(records) {
  const people = records || [];

  // Build reverse-relationship maps from ALL data in the JSON
  const childrenMap = new Map(); // parentId → Set of child ids
  const spouseMap = new Map();   // personId → Set of spouse ids

  people.forEach((person) => {
    const rels = person.rels || {};
    const personId = person.id;

    // 1) If this person has a father/mother, add them as a child of that parent
    if (rels.father) {
      if (!childrenMap.has(rels.father)) childrenMap.set(rels.father, new Set());
      childrenMap.get(rels.father).add(personId);
    }
    if (rels.mother) {
      if (!childrenMap.has(rels.mother)) childrenMap.set(rels.mother, new Set());
      childrenMap.get(rels.mother).add(personId);
    }

    // 2) If this person declares children, record them (forward direction)
    (rels.children || []).forEach((childId) => {
      if (!childrenMap.has(personId)) childrenMap.set(personId, new Set());
      childrenMap.get(personId).add(childId);
    });

    // 3) Record spouse relationships both ways
    (rels.spouses || []).forEach((spouseId) => {
      // A → B
      if (!spouseMap.has(personId)) spouseMap.set(personId, new Set());
      spouseMap.get(personId).add(spouseId);
      // B → A (reverse)
      if (!spouseMap.has(spouseId)) spouseMap.set(spouseId, new Set());
      spouseMap.get(spouseId).add(personId);
    });
  });

  // Augment each person with the merged relationship data
  return people.map((person) => {
    const rels = person.rels || {};
    const parentIds = [rels.mother, rels.father, ...(rels.parents || [])].filter(Boolean);
    const personId = person.id;

    // Merge explicit spouses + reverse spouses from the map
    const explicitSpouses = new Set((rels.spouses || []).filter(Boolean));
    const reverseSpouses = spouseMap.get(personId) || new Set();
    const allSpouses = new Set([...explicitSpouses, ...reverseSpouses]);

    // Merge explicit children + reverse children from the map
    const explicitChildren = new Set((rels.children || []).filter(Boolean));
    const reverseChildren = childrenMap.get(personId) || new Set();
    const allChildren = new Set([...explicitChildren, ...reverseChildren]);

    return {
      ...person,
      rels: {
        ...rels,
        parents: parentIds.filter((id, index, arr) => arr.indexOf(id) === index),
        spouses: [...allSpouses],
        children: [...allChildren]
      }
    };
  });
}

function buildFamilyUnit(personId) {
  const person = peopleById.get(personId);
  if (!person) return null;

  const spouseId = (person.rels?.spouses || [])[0];
  const spouse = spouseId ? peopleById.get(spouseId) : null;
  const children = (person.rels?.children || [])
    .map((childId) => buildFamilyUnit(childId))
    .filter(Boolean);

  return {
    id: person.id,
    person,
    spouse,
    children
  };
}

function computeSubtreeWidth(unit) {
  if (!unit.children.length) return cardWidth;
  const childWidths = unit.children.reduce((sum, child) => sum + computeSubtreeWidth(child), 0);
  return childWidths + (unit.children.length - 1) * horizontalGap;
}

function layoutTree(unit, x, y) {
  unit.x = x;
  unit.y = y;

  if (!unit.children.length) return;

  const totalWidth = unit.children.reduce((sum, child) => sum + computeSubtreeWidth(child), 0) + (unit.children.length - 1) * horizontalGap;
  let cursor = x - totalWidth / 2;

  unit.children.forEach((child) => {
    const childWidth = computeSubtreeWidth(child);
    const childCenter = cursor + childWidth / 2;
    layoutTree(child, childCenter, y + verticalGap);
    cursor += childWidth + horizontalGap;
  });
}

function collectUnits(unit, collection) {
  collection.push(unit);
  unit.children.forEach((child) => collectUnits(child, collection));
}

function renderTree(unit) {
  const container = document.getElementById('FamilyChart');
  if (!container) return;

  const units = [];
  collectUnits(unit, units);

  const minX = Math.min(...units.map((item) => item.x));
  const maxX = Math.max(...units.map((item) => item.x));
  const minY = Math.min(...units.map((item) => item.y));
  const maxY = Math.max(...units.map((item) => item.y));

  const offsetX = 80 - minX;
  const offsetY = 40 - minY;
  const width = Math.max(960, maxX - minX + cardWidth + 240);
  const height = Math.max(680, maxY - minY + cardHeight + 240);

  const stage = document.createElement('div');
  stage.className = 'family-chart-stage';
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `scale(${zoomLevel})`;
  stage.style.transformOrigin = 'top left';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('family-chart-lines');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  const nodeLayer = document.createElement('div');
  nodeLayer.className = 'family-chart-node-layer';

  units.forEach((currentUnit) => {
    currentUnit.children.forEach((child) => {
      const parentX = currentUnit.x + offsetX + cardWidth / 2;
      const parentY = currentUnit.y + offsetY + cardHeight;
      const childX = child.x + offsetX + cardWidth / 2;
      const childY = child.y + offsetY;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', parentX);
      line.setAttribute('y1', parentY);
      line.setAttribute('x2', childX);
      line.setAttribute('y2', childY);
      line.setAttribute('class', 'family-chart-link');
      svg.appendChild(line);
    });
  });

  units.forEach((currentUnit) => {
    const isSpecial = formatName(currentUnit.person) === 'Prashant Mahato';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `family-chart-node ${currentUnit.id === activeRootId ? 'active' : ''} ${isSpecial ? 'family-chart-node-special' : ''}`;
    card.style.left = `${currentUnit.x + offsetX}px`;
    card.style.top = `${currentUnit.y + offsetY}px`;
    card.innerHTML = `
      <div class="family-chart-node-header">
        <div class="family-chart-avatar ${isSpecial ? 'special-avatar' : ''}">${getInitials(currentUnit.person)}</div>
        <div class="family-chart-heading">
          <div class="family-chart-card-title">${formatName(currentUnit.person)}</div>
          <div class="family-chart-card-subtitle">${formatRole(currentUnit.person)}</div>
        </div>
      </div>
      <div class="family-chart-badges">
        ${isSpecial ? '<span class="family-chart-badge special">Creator</span>' : `<span class="family-chart-badge">${getBadgeText(currentUnit)}</span>`}
        <span class="family-chart-badge secondary">${currentUnit.children.length ? `${currentUnit.children.length} child${currentUnit.children.length > 1 ? 'ren' : ''}` : 'Leaf node'}</span>
      </div>
      <div class="family-chart-card-meta">${currentUnit.spouse ? `Spouse: ${formatName(currentUnit.spouse)}` : 'Family branch'}</div>
    `;

    card.addEventListener('click', () => {
      activeRootId = currentUnit.person.id;
      const nextUnit = buildFamilyUnit(activeRootId);
      if (nextUnit) {
        layoutTree(nextUnit, 0, 0);
        renderTree(nextUnit);
      }
    });

    nodeLayer.appendChild(card);
  });

  stage.appendChild(svg);
  stage.appendChild(nodeLayer);
  container.innerHTML = '';
  container.appendChild(stage);
}

function updateZoomButtons() {
  document.getElementById('zoomResetBtn').textContent = `${Math.round(zoomLevel * 100)}%`;
}

function changeZoom(delta) {
  zoomLevel = Math.min(maxZoom, Math.max(minZoom, zoomLevel + delta));
  updateZoomButtons();
  const root = document.querySelector('.family-chart-stage');
  if (root) root.style.transform = `scale(${zoomLevel})`;
}

function openRoot(personId) {
  activeRootId = personId;
  const rootUnit = buildFamilyUnit(personId);
  if (rootUnit) {
    layoutTree(rootUnit, 0, 0);
    renderTree(rootUnit);
    updateStatus(`Showing branch for ${formatName(peopleById.get(personId))}`);
  }
}

function resetTree() {
  const rootPerson = Array.from(peopleById.values()).find((person) => (person.rels?.parents || []).length === 0) || Array.from(peopleById.values())[0];
  if (rootPerson) {
    openRoot(rootPerson.id);
    zoomLevel = 1;
    changeZoom(0);
    updateStatus('Reset to root branch.');
  }
}

function searchFamily(query) {
  const normalizedQuery = (query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    updateStatus('Please enter a name to search.');
    return;
  }

  const match = Array.from(peopleById.values()).find((person) => formatName(person).toLowerCase().includes(normalizedQuery));
  if (match) {
    openRoot(match.id);
    updateStatus(`Found ${formatName(match)}. Showing their branch.`);
  } else {
    updateStatus(`No family member matched “${query}”.`);
  }
}

function randomRoot() {
  const people = Array.from(peopleById.values());
  if (!people.length) return;
  const randomPerson = people[Math.floor(Math.random() * people.length)];
  openRoot(randomPerson.id);
  updateStatus(`Random branch: ${formatName(randomPerson)}`);
}

function updateStatus(message) {
  const status = document.getElementById('familyChartStatus');
  if (status) status.textContent = message;
}

function addPinchZoom(container) {
  let startDistance = null;
  let startZoom = zoomLevel;

  const getDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  container.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      startDistance = getDistance(event.touches);
      startZoom = zoomLevel;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (event) => {
    if (event.touches.length === 2 && startDistance) {
      const currentDistance = getDistance(event.touches);
      const distanceDelta = currentDistance - startDistance;
      const scaleDelta = distanceDelta / 300;
      zoomLevel = Math.min(maxZoom, Math.max(minZoom, startZoom + scaleDelta));
      updateZoomButtons();
      const root = document.querySelector('.family-chart-stage');
      if (root) root.style.transform = `scale(${zoomLevel})`;
      event.preventDefault();
    }
  }, { passive: false });

  container.addEventListener('touchend', (event) => {
    if (event.touches.length < 2) {
      startDistance = null;
    }
  });
}

async function renderFamilyChart() {
  const container = document.getElementById('FamilyChart');
  if (!container) return;

  try {
    const response = await fetch('assets/Mahato Family Tree.JSON');
    if (!response.ok) throw new Error('Unable to load family data');

    const records = await response.json();
    const normalized = normalizeFamilyData(records);

    if (!normalized.length) {
      container.innerHTML = '<div class="family-chart-empty">No family data available.</div>';
      return;
    }

    peopleById = new Map(normalized.map((person) => [person.id, person]));
    const rootPerson = normalized.find((person) => (person.rels?.parents || []).length === 0) || normalized[0];
    activeRootId = rootPerson.id;

    const rootUnit = buildFamilyUnit(rootPerson.id);
    layoutTree(rootUnit, 0, 0);
    renderTree(rootUnit);
    updateStatus(`Showing branch for ${formatName(rootPerson)}`);
    addPinchZoom(container);
  } catch (error) {
    console.error('Family chart load error:', error);
    container.innerHTML = `<div class="family-chart-empty">The family tree could not be loaded: ${error.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderFamilyChart();
  document.getElementById('zoomInBtn')?.addEventListener('click', () => changeZoom(zoomStep));
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => changeZoom(-zoomStep));
  document.getElementById('zoomResetBtn')?.addEventListener('click', () => {
    zoomLevel = 1;
    changeZoom(0);
  });
  document.getElementById('resetTreeBtn')?.addEventListener('click', () => resetTree());
  document.getElementById('randomBtn')?.addEventListener('click', () => randomRoot());
  document.getElementById('searchBtn')?.addEventListener('click', () => {
    const query = document.getElementById('familySearchInput')?.value || '';
    searchFamily(query);
  });
  document.getElementById('familySearchInput')?.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      const query = document.getElementById('familySearchInput')?.value || '';
      searchFamily(query);
    }
  });
});
