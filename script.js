const GRID_SIZE = 32;
const NODE_MIN_WIDTH = 256;
const NODE_MIN_HEIGHT = 128;
const CONNECTION_POINT_Y_OFFSET = 32;
const CONNECTION_POINT_Y_SPACING = 32;
const ZOOM_SENSITIVITY = 0.1;
const MAX_ZOOM = 4;
const MIN_ZOOM = 0.25;

const COLORS = {
    default: '#666666',
    red: '#ff4444',
    green: '#44ff44',
    blue: '#4444ff',
    yellow: '#ffff44',
    purple: '#ff44ff',
    orange: '#ff8844',
    cyan: '#44ffff'
};

class NodeEditor {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.canvasContent = document.getElementById('canvasContent');
        this.selectionBox = document.getElementById('selectionBox');
        this.propertiesPanel = document.getElementById('propertiesPanel');
        this.propertiesContent = document.getElementById('propertiesContent');
        this.contextMenu = document.getElementById('contextMenu');
        this.connectionContextMenu = document.getElementById('connectionContextMenu');

        this.state = this.getInitialState();

        this.interaction = {
            isDragging: false,
            isResizing: false,
            isPanning: false,
            isConnecting: false,
            isSelecting: false,
            didDrag: false,
            draggedNodes: [],
            resizeNode: null,
            connectionStartPoint: null,
            panStart: { x: 0, y: 0 },
            selectionStart: { x: 0, y: 0 },
            lastMousePosition: { x: 0, y: 0 },
        };

        this.initialize();
    }

    initialize() {
        this.resetState();
        this._bindEventListeners();
        this.render();
    }

    getInitialState() {
        const masterGraph = {
            id: 'root',
            nodes: [],
            connections: [],
            name: 'Root',
            pan: { x: 0, y: 0 },
            zoom: 1
        };

        return {
            graphs: { 'root': masterGraph },
            navigationStack: ['root'],
            nodeCounter: 1,
            selectedNodeIds: new Set(),
            copiedNodes: [],
            contextMenuTarget: null,
            selectedConnectionId: null,
        };
    }

    resetState() {
        this.state = this.getInitialState();
    }

    _bindEventListeners() {
        this.canvas.addEventListener('mousedown', this._onCanvasMouseDown.bind(this));
        this.canvas.addEventListener('wheel', this._onCanvasWheel.bind(this));
        this.canvas.addEventListener('contextmenu', this._onCanvasContextMenu.bind(this));

        this.canvasContent.addEventListener('input', this._onCanvasContentInput.bind(this));

        document.addEventListener('mousemove', this._onMouseMove.bind(this));
        document.addEventListener('mouseup', this._onMouseUp.bind(this));
        document.addEventListener('click', this._onGlobalClick.bind(this));
        document.addEventListener('keydown', this._onKeyDown.bind(this));

        document.getElementById('addNodeBtn').addEventListener('click', () => this.addNode());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveGraph());
        // Link to the new, improved simple save function
        document.getElementById('saveSimpleBtn').addEventListener('click', () => this.saveSimpleGraph());
        document.getElementById('loadBtn').addEventListener('click', () => document.getElementById('loadFile').click());
        document.getElementById('loadFile').addEventListener('change', (e) => this.loadGraph(e));
        document.getElementById('copyBtn').addEventListener('click', () => this.copySelectedNodes());
        document.getElementById('pasteBtn').addEventListener('click', () => this.pasteNodes());
        document.getElementById('deleteBtn').addEventListener('click', () => this.deleteSelected());

        this.contextMenu.addEventListener('click', this._onContextMenuClick.bind(this));
        this.connectionContextMenu.addEventListener('click', this._onContextMenuClick.bind(this));
    }

    getCurrentGraph() {
        const currentGraphId = this.state.navigationStack[this.state.navigationStack.length - 1];
        return this.state.graphs[currentGraphId];
    }

    findNodeById(nodeId, graphId = null) {
        const graph = graphId ? this.state.graphs[graphId] : this.getCurrentGraph();
        return graph ? graph.nodes.find(n => n.id === nodeId) : undefined;
    }

    findGraphById(graphId) {
        return this.state.graphs[graphId];
    }

    render() {
        this._renderCanvas();
        this._renderToolbar();
        this._renderPropertiesPanel();
    }

    _renderCanvas() {
        const graph = this.getCurrentGraph();

        const textScrolls = {};
        this.canvasContent.querySelectorAll('.node-text').forEach(ta => {
            const nodeId = ta.closest('.node').dataset.nodeId;
            textScrolls[nodeId] = { top: ta.scrollTop, left: ta.scrollLeft };
        });

        this.canvasContent.innerHTML = '<div class="selection-box" id="selectionBox"></div>';
        this.selectionBox = document.getElementById('selectionBox');

        const transform = `translate(${graph.pan.x}px, ${graph.pan.y}px) scale(${graph.zoom})`;
        this.canvasContent.style.transform = transform;

        const gridSize = GRID_SIZE * graph.zoom;
        this.canvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
        this.canvas.style.backgroundPosition = `${graph.pan.x % gridSize}px ${graph.pan.y % gridSize}px`;

        graph.nodes.forEach(nodeData => this._renderNode(nodeData));
        graph.connections.forEach(connData => this._renderConnection(connData));

        Object.keys(textScrolls).forEach(nodeId => {
            const textarea = this.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-text`);
            if (textarea) {
                textarea.scrollTop = textScrolls[nodeId].top;
                textarea.scrollLeft = textScrolls[nodeId].left;
            }
        });
    }

    _renderNode(nodeData) {
        const nodeEl = document.createElement('div');
        const isSelected = this.state.selectedNodeIds.has(nodeData.id);
        const hasSubgraph = nodeData.subgraphId && this.findGraphById(nodeData.subgraphId)?.nodes.length > 0;

        nodeEl.className = `node color-${nodeData.color} ${isSelected ? 'selected' : ''} ${hasSubgraph ? 'has-subgraph' : ''}`;
        nodeEl.dataset.nodeId = nodeData.id;
        nodeEl.style.left = `${nodeData.x}px`;
        nodeEl.style.top = `${nodeData.y}px`;
        nodeEl.style.width = `${nodeData.width}px`;
        nodeEl.style.height = `${nodeData.height}px`;

        let textContentHTML = '';
        if (nodeData.type === 'default') {
            textContentHTML = `<textarea class="node-text" placeholder="Enter text...">${nodeData.text}</textarea>`;
        }

        let innerHTML = `
            <div class="node-header">${nodeData.title}</div>
            <div class="node-content">
                ${textContentHTML}
            </div>
        `;

        if (nodeData.type === 'default') {
            innerHTML += `<div class="resize-handle" data-node-id="${nodeData.id}"></div>`;
        }

        nodeEl.innerHTML = innerHTML;
        this.canvasContent.appendChild(nodeEl);

        this._renderNodeConnectionPoints(nodeEl, nodeData);
    }

    _renderNodeConnectionPoints(nodeEl, nodeData) {
        const createPoint = (pointData, type, index) => {
            const yPos = CONNECTION_POINT_Y_OFFSET + (index * CONNECTION_POINT_Y_SPACING);
            const point = document.createElement('div');
            point.className = `connection-point ${type}`;
            point.dataset.nodeId = nodeData.id;
            point.dataset.type = type;
            point.dataset.index = index;
            point.style.top = `${yPos}px`;
            point.style.backgroundColor = pointData.color;

            const label = document.createElement('div');
            label.className = 'connection-point-label';
            label.textContent = pointData.name;
            label.style.top = `${yPos}px`;

            nodeEl.appendChild(point);
            nodeEl.appendChild(label);
        };

        nodeData.inputs.forEach((input, i) => createPoint(input, 'input', i));
        nodeData.outputs.forEach((output, i) => createPoint(output, 'output', i));

        const maxIO = Math.max(nodeData.inputs.length, nodeData.outputs.length);
        const contentMinHeight = (maxIO > 0) ? (maxIO * CONNECTION_POINT_Y_SPACING + 16) : 0;
        nodeEl.querySelector('.node-content').style.minHeight = `${contentMinHeight}px`;
    }

    _renderConnection(connData) {
        const startNode = this.findNodeById(connData.start.nodeId);
        const endNode = this.findNodeById(connData.end.nodeId);

        if (!startNode || !endNode) return;

        const startNodeEl = this.canvasContent.querySelector(`[data-node-id="${startNode.id}"]`);
        const endNodeEl = this.canvasContent.querySelector(`[data-node-id="${endNode.id}"]`);

        if (!startNodeEl || !endNodeEl) return;

        const startColor = startNode.outputs[connData.start.index]?.color || COLORS.default;
        const endColor = endNode.inputs[connData.end.index]?.color || COLORS.default;

        const line = document.createElement('div');
        line.className = 'connection-line';
        line.dataset.connectionId = connData.id;

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, 'svg');
        const defs = document.createElementNS(svgNS, 'defs');
        const gradient = document.createElementNS(svgNS, 'linearGradient');
        const stop1 = document.createElementNS(svgNS, 'stop');
        const stop2 = document.createElementNS(svgNS, 'stop');
        const path = document.createElementNS(svgNS, 'path');

        const gradId = `grad_${connData.id}`;
        gradient.setAttribute('id', gradId);
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');

        stop1.setAttribute('offset', '0%');
        stop1.style.stopColor = startColor;
        stop2.setAttribute('offset', '100%');
        stop2.style.stopColor = endColor;

        path.setAttribute('stroke', `url(#${gradId})`);
        path.dataset.connectionId = connData.id;

        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);
        svg.appendChild(defs);
        svg.appendChild(path);
        line.appendChild(svg);
        this.canvasContent.appendChild(line);

        this.updateConnectionPath(connData.id);
    }

    _renderToolbar() {
        document.getElementById('copyBtn').disabled = this.state.selectedNodeIds.size === 0;
        document.getElementById('pasteBtn').disabled = this.state.copiedNodes.length === 0;
        document.getElementById('deleteBtn').disabled = this.state.selectedNodeIds.size === 0;

        const count = this.state.selectedNodeIds.size;
        const countEl = document.getElementById('selectedCount');
        countEl.textContent = count > 0 ? `${count} node${count > 1 ? 's' : ''} selected` : '';

        const breadcrumbsContainer = document.getElementById('breadcrumbs');
        breadcrumbsContainer.innerHTML = '';
        this.state.navigationStack.forEach((graphId, index) => {
            const graph = this.findGraphById(graphId);
            if (!graph) return;

            const isLast = index === this.state.navigationStack.length - 1;

            if (graphId === 'root' && isLast) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'breadcrumb-input';
                input.value = graph.name;

                input.oninput = (e) => {
                    const rootGraph = this.findGraphById('root');
                    if (rootGraph) {
                        rootGraph.name = e.target.value;
                    }
                };

                input.onchange = (e) => {
                    const rootGraph = this.findGraphById('root');
                    if (rootGraph && rootGraph.name.trim() === '') {
                        rootGraph.name = 'Root';
                        e.target.value = 'Root';
                    }
                };
                breadcrumbsContainer.appendChild(input);

            } else {
                const item = document.createElement('span');
                item.textContent = graph.name;
                item.className = 'breadcrumb-item';

                if (isLast) {
                    item.classList.add('active');
                } else {
                    item.onclick = () => this.navigateToLevel(index);
                }
                breadcrumbsContainer.appendChild(item);
            }

            if (!isLast) {
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '>';
                breadcrumbsContainer.appendChild(separator);
            }
        });
    }

    _renderPropertiesPanel() {
        if (this.state.selectedNodeIds.size === 0) {
            this.propertiesPanel.classList.remove('show');
            return;
        }

        this.propertiesPanel.classList.add('show');
        let html = '';

        if (this.state.selectedNodeIds.size > 1) {
            html = `<p>${this.state.selectedNodeIds.size} nodes selected</p>`;
        } else {
            const nodeId = this.state.selectedNodeIds.values().next().value;
            const nodeData = this.findNodeById(nodeId);
            if (!nodeData) return;

            const isIoNode = nodeData.type === 'graph-input' || nodeData.type === 'graph-output';

            const textContentHTML = !isIoNode ? `
                <div class="property-group">
                    <label>Text Content:</label>
                    <textarea id="propNodeContent" rows="4" data-node-id="${nodeId}">${nodeData.text}</textarea>
                </div>
            ` : '';

            html = `
                <div class="property-group">
                    <label>Node Title:</label>
                    <input type="text" id="propNodeTitle" value="${nodeData.title}" data-node-id="${nodeId}">
                </div>
                ${textContentHTML}
                <div class="property-group">
                    <label>Node Color:</label>
                    <div class="color-options">
                        ${Object.keys(COLORS).map(color => `
                            <div class="color-option ${color} ${nodeData.color === color ? 'selected' : ''}" 
                                 onclick="window.nodeEditor.setNodeColor('${nodeId}', '${color}')"></div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        this.propertiesContent.innerHTML = html;

        const titleInput = document.getElementById('propNodeTitle');
        const contentInput = document.getElementById('propNodeContent');
        if (titleInput) {
            titleInput.addEventListener('input', (e) => this.updateNodeProperty(e.target.dataset.nodeId, 'title', e.target.value, e.target));
        }
        if (contentInput) {
            contentInput.addEventListener('input', (e) => this.updateNodeProperty(e.target.dataset.nodeId, 'text', e.target.value, e.target));
        }
    }

    updateConnectionPath(connectionId) {
        const graph = this.getCurrentGraph();
        const connection = graph.connections.find(c => c.id === connectionId);
        if (!connection) return;

        const line = this.canvasContent.querySelector(`.connection-line[data-connection-id="${connectionId}"]`);
        if (!line) return;

        const startNodeEl = this.canvasContent.querySelector(`[data-node-id="${connection.start.nodeId}"]`);
        const endNodeEl = this.canvasContent.querySelector(`[data-node-id="${connection.end.nodeId}"]`);

        if (!startNodeEl || !endNodeEl) {
            line.remove();
            return;
        }

        const startNodeData = this.findNodeById(connection.start.nodeId);

        const startX = startNodeData.x + startNodeEl.offsetWidth;
        const startY = startNodeData.y + CONNECTION_POINT_Y_OFFSET + (connection.start.index * CONNECTION_POINT_Y_SPACING) + 8;
        const endX = this.findNodeById(connection.end.nodeId).x;
        const endY = this.findNodeById(connection.end.nodeId).y + CONNECTION_POINT_Y_OFFSET + (connection.end.index * CONNECTION_POINT_Y_SPACING) + 8;

        const path = line.querySelector('path');
        const controlOffset = Math.abs(endX - startX) * 0.5;
        const pathData = `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`;
        path.setAttribute('d', pathData);

        const gradient = line.querySelector('linearGradient');
        if (gradient) {
            gradient.setAttribute('x1', startX);
            gradient.setAttribute('y1', startY);
            gradient.setAttribute('x2', endX);
            gradient.setAttribute('y2', endY);
        }
    }

    updateAllConnectionPaths() {
        const graph = this.getCurrentGraph();
        graph.connections.forEach(conn => this.updateConnectionPath(conn.id));
    }

    getCanvasCoordinates(clientX, clientY) {
        const graph = this.getCurrentGraph();
        const canvasRect = this.canvas.getBoundingClientRect();
        const x = (clientX - canvasRect.left - graph.pan.x) / graph.zoom;
        const y = (clientY - canvasRect.top - graph.pan.y) / graph.zoom;
        return { x, y };
    }

    snapToGrid(value) {
        return Math.round(value / GRID_SIZE) * GRID_SIZE;
    }

    _updateParentNodeInterface() {
        if (this.state.navigationStack.length <= 1) return;

        const currentGraphId = this.state.navigationStack[this.state.navigationStack.length - 1];
        const parentGraphId = this.state.navigationStack[this.state.navigationStack.length - 2];
        const parentGraph = this.findGraphById(parentGraphId);

        const parentNodeData = parentGraph.nodes.find(n => n.subgraphId === currentGraphId);
        if (!parentNodeData) return;

        const currentGraph = this.findGraphById(currentGraphId);
        const graphInputs = currentGraph.nodes.filter(n => n.type === 'graph-input');
        const graphOutputs = currentGraph.nodes.filter(n => n.type === 'graph-output');

        parentNodeData.inputs = graphInputs.map(inputNode => ({
            name: inputNode.title,
            color: COLORS[inputNode.color] || COLORS.default
        }));
        parentNodeData.outputs = graphOutputs.map(outputNode => ({
            name: outputNode.title,
            color: COLORS[outputNode.color] || COLORS.default
        }));
    }

    addNode(type = 'default', position = null) {
        const graph = this.getCurrentGraph();

        if (!position) {
            const center = this.getCanvasCoordinates(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
            position = { x: center.x, y: center.y };
        }

        const nodeId = `node_${this.state.nodeCounter++}`;
        const nodeData = {
            id: nodeId,
            x: this.snapToGrid(position.x),
            y: this.snapToGrid(position.y),
            width: NODE_MIN_WIDTH,
            height: NODE_MIN_HEIGHT,
            color: 'default',
            type: type,
            inputs: [],
            outputs: [],
            subgraphId: null,
            text: '',
        };

        switch (type) {
            case 'default':
                nodeData.title = `Node ${this.state.nodeCounter - 1}`;
                const subgraph = {
                    id: `graph_${nodeId}`,
                    name: nodeData.title,
                    nodes: [],
                    connections: [],
                    pan: { x: 0, y: 0 },
                    zoom: 1,
                };
                this.state.graphs[subgraph.id] = subgraph;
                nodeData.subgraphId = subgraph.id;
                break;
            case 'graph-input':
                nodeData.title = 'Input';
                nodeData.color = 'cyan';
                nodeData.outputs = [{ name: 'Value', color: COLORS.cyan }];
                break;
            case 'graph-output':
                nodeData.title = 'Output';
                nodeData.color = 'orange';
                nodeData.inputs = [{ name: 'Value', color: COLORS.orange }];
                break;
        }

        graph.nodes.push(nodeData);
        if (type !== 'default') {
            this._updateParentNodeInterface();
        }

        this.render();
    }

    deleteSelected() {
        if (this.state.selectedNodeIds.size === 0) return;
        const graph = this.getCurrentGraph();
        let ioNodeDeleted = false;

        graph.nodes = graph.nodes.filter(node => {
            if (this.state.selectedNodeIds.has(node.id)) {
                if (node.type !== 'default') ioNodeDeleted = true;
                if (node.subgraphId) delete this.state.graphs[node.subgraphId];
                return false;
            }
            return true;
        });

        graph.connections = graph.connections.filter(conn =>
            !this.state.selectedNodeIds.has(conn.start.nodeId) &&
            !this.state.selectedNodeIds.has(conn.end.nodeId)
        );

        this.state.selectedNodeIds.clear();

        if (ioNodeDeleted) {
            this._updateParentNodeInterface();
        }

        this.render();
    }

    clearSelection() {
        if (this.state.selectedNodeIds.size > 0) {
            this.state.selectedNodeIds.clear();
            this.render();
        }
    }

    selectNodesInBox(box) {
        const graph = this.getCurrentGraph();
        graph.nodes.forEach(node => {
            const nodeRect = {
                left: node.x,
                top: node.y,
                right: node.x + node.width,
                bottom: node.y + node.height,
            };
            if (box.right > nodeRect.left && box.left < nodeRect.right && box.bottom > nodeRect.top && box.top < nodeRect.bottom) {
                this.state.selectedNodeIds.add(node.id);
            }
        });
        this.render();
    }

    updateNodeProperty(nodeId, property, value, sourceElement = null) {
        const node = this.findNodeById(nodeId);
        if (!node) return;

        node[property] = value;

        if (property === 'title') {
            const nodeHeader = this.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-header`);
            if (nodeHeader && nodeHeader !== sourceElement) {
                nodeHeader.textContent = value;
            }

            const propTitleInput = document.getElementById('propNodeTitle');
            if (propTitleInput && propTitleInput !== sourceElement) {
                propTitleInput.value = value;
            }

            let needsToolbarRender = false;
            if (node.subgraphId) {
                const subgraph = this.findGraphById(node.subgraphId);
                if (subgraph) {
                    subgraph.name = value;
                    if (this.state.navigationStack.includes(node.subgraphId)) {
                        needsToolbarRender = true;
                    }
                }
            }

            if (node.type === 'graph-input' || node.type === 'graph-output') {
                this._updateParentNodeInterface();
                if (needsToolbarRender) {
                    this._renderToolbar();
                }
            } else if (needsToolbarRender) {
                this._renderToolbar();
            }

        } else if (property === 'text') {
            const nodeTextarea = this.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-text`);
            if (nodeTextarea && nodeTextarea !== sourceElement) {
                nodeTextarea.value = value;
            }

            const propContentTextarea = document.getElementById('propNodeContent');
            if (propContentTextarea && propContentTextarea !== sourceElement) {
                propContentTextarea.value = value;
            }
        }
    }

    setNodeColor(nodeId, colorName) {
        const node = this.findNodeById(nodeId);
        if (!node) return;

        node.color = colorName;
        const newPinColor = COLORS[colorName] || COLORS.default;

        if (node.type === 'graph-input') {
            node.outputs[0].color = newPinColor;
        } else if (node.type === 'graph-output') {
            node.inputs[0].color = newPinColor;
        }

        if (node.type !== 'default') {
            this._updateParentNodeInterface();
        }

        this.render();
        this.updateAllConnectionPaths();
    }

    enterNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (node && node.subgraphId) {
            this.state.navigationStack.push(node.subgraphId);
            this.clearSelection();
            this.render();
        }
    }

    navigateToLevel(level) {
        if (level >= this.state.navigationStack.length - 1) return;
        this.state.navigationStack = this.state.navigationStack.slice(0, level + 1);
        this.clearSelection();
        this.render();
    }

    // ----- SAVE & LOAD -----

    /**
     * Saves the full graph data to the original, detailed JSON format.
     */
    saveGraph() {
        const rootGraph = this.findGraphById('root');
        if (!rootGraph) return;

        if (rootGraph.name === 'Root' || rootGraph.name.trim() === '') {
            const newName = prompt("Please enter a project name before saving:", "My Project");
            if (newName && newName.trim() !== '') {
                rootGraph.name = newName.trim();
                this._renderToolbar();
            } else {
                alert("Save cancelled. A valid project name is required.");
                return;
            }
        }

        const fileName = `${rootGraph.name.replace(/[^a-z0-9_ -]/gi, '_').trim()}.json`;

        const saveData = {
            version: "1.0.0",
            graphs: this.state.graphs
        };

        const dataStr = JSON.stringify(saveData, null, 2);

        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', fileName);
        linkElement.click();
    }

    /**
     * UPDATED: Smart loader that detects file format (full, legacy simple, or new readable) and loads accordingly.
     */
    loadGraph(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const loadedData = JSON.parse(e.target.result);

                if (!loadedData) {
                    throw new Error("File is empty or invalid.");
                }
                
                // Check for the new readable format first
                if (loadedData.format === "node-graph-v2-readable" && loadedData.graph) {
                    this._loadReadableGraph(loadedData);
                
                // Check for the original, detailed format
                } else if (loadedData.graphs && loadedData.version) {
                    this._loadFullGraph(loadedData);
                
                // Check for the legacy, simplified format for backward compatibility
                } else if (loadedData.story && loadedData.title) {
                    this._loadLegacySimpleGraph(loadedData);
                
                } else {
                    throw new Error("Invalid or unsupported file format.");
                }

            } catch (error) {
                alert('Error loading graph: ' + error.message);
                console.error(error);
            }
        };

        reader.readAsText(file);
        event.target.value = ''; // Reset file input
    }
    
    _loadFullGraph(loadedData) {
        this.resetState();
        this.state.graphs = loadedData.graphs;

        let maxId = 0;
        Object.values(this.state.graphs).forEach(graph => {
            graph.nodes.forEach(node => {
                const idNum = parseInt(node.id.split('_')[1], 10);
                if (!isNaN(idNum) && idNum > maxId) {
                    maxId = idNum;
                }
            });
        });
        this.state.nodeCounter = maxId + 1;
        this.render();
    }

    copySelectedNodes() {
        if (this.state.selectedNodeIds.size === 0) return;
        const graph = this.getCurrentGraph();

        this.state.copiedNodes = graph.nodes
            .filter(node => this.state.selectedNodeIds.has(node.id))
            .map(node => JSON.parse(JSON.stringify(node)));

        this._renderToolbar();
    }

    pasteNodes() {
        if (this.state.copiedNodes.length === 0) return;
        const graph = this.getCurrentGraph();
        this.clearSelection();

        this.state.copiedNodes.forEach(nodeData => {
            const newNode = JSON.parse(JSON.stringify(nodeData));
            newNode.id = `node_${this.state.nodeCounter++}`;
            newNode.x += GRID_SIZE;
            newNode.y += GRID_SIZE;

            if (newNode.subgraphId) {
                const originalSubgraph = this.findGraphById(newNode.subgraphId);
                if (originalSubgraph) {
                    const newSubgraph = JSON.parse(JSON.stringify(originalSubgraph));
                    newSubgraph.id = `graph_${newNode.id}`;
                    newSubgraph.name = newNode.title;
                    this.state.graphs[newSubgraph.id] = newSubgraph;
                    newNode.subgraphId = newSubgraph.id;
                }
            }

            graph.nodes.push(newNode);
            this.state.selectedNodeIds.add(newNode.id);
        });

        this.render();
    }
    
    // ----- NEW READABLE & DATA-COMPLETE SAVE/LOAD -----

    /**
     * REPLACED: Saves the graph to a new, human-readable JSON file that preserves all data.
     * This format uses nested objects for subgraphs and readable string IDs for nodes.
     */
    saveSimpleGraph() {
        const rootGraph = this.findGraphById('root');
        if (!rootGraph) return;

        if (rootGraph.name === 'Root' || rootGraph.name.trim() === '') {
            const newName = prompt("Please enter a project name before saving:", "My Project");
            if (newName && newName.trim() !== '') {
                rootGraph.name = newName.trim();
                this._renderToolbar();
            } else {
                alert("Save cancelled. A valid project name is required.");
                return;
            }
        }

        const fileName = `${rootGraph.name.replace(/[^a-z0-9_ -]/gi, '_').trim()}_readable.json`;

        // 1. Create unique handles for every node across all graphs.
        const nodeIdToHandleMap = new Map();
        const usedHandles = new Set();
        Object.values(this.state.graphs).forEach(graph => {
            graph.nodes.forEach(node => {
                const baseName = node.title || node.type;
                const handle = this._generateUniqueHandle(baseName, usedHandles);
                usedHandles.add(handle);
                nodeIdToHandleMap.set(node.id, handle);
            });
        });

        // 2. Recursively convert the entire graph structure.
        const readableGraph = this._convertGraphToReadable(rootGraph.id, nodeIdToHandleMap);

        const saveData = {
            format: "node-graph-v2-readable", // Version identifier
            title: rootGraph.name,
            graph: readableGraph
        };

        const dataStr = JSON.stringify(saveData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', fileName);
        linkElement.click();
    }

    /**
     * HELPER: Recursively converts a graph and its subgraphs into a nested, readable format.
     */
    _convertGraphToReadable(graphId, nodeIdToHandleMap) {
        const graph = this.findGraphById(graphId);
        if (!graph) return null;

        const readableGraph = {
            id: graph.id,
            name: graph.name,
            pan: { ...graph.pan },
            zoom: graph.zoom,
            nodes: [],
            connections: []
        };

        readableGraph.nodes = graph.nodes.map(node => {
            const readableNode = JSON.parse(JSON.stringify(node));
            readableNode.id = nodeIdToHandleMap.get(node.id);

            if (readableNode.subgraphId) {
                readableNode.subgraph = this._convertGraphToReadable(readableNode.subgraphId, nodeIdToHandleMap);
                delete readableNode.subgraphId;
            }
            return readableNode;
        });

        readableGraph.connections = graph.connections.map(conn => {
            const startNode = this.findNodeById(conn.start.nodeId, graph.id);
            const endNode = this.findNodeById(conn.end.nodeId, graph.id);
            if (!startNode || !endNode) return null;

            return {
                id: conn.id,
                from: nodeIdToHandleMap.get(conn.start.nodeId),
                from_pin: startNode.outputs[conn.start.index]?.name || `output_${conn.start.index}`,
                to: nodeIdToHandleMap.get(conn.end.nodeId),
                to_pin: endNode.inputs[conn.end.index]?.name || `input_${conn.end.index}`
            };
        }).filter(Boolean);

        return readableGraph;
    }
    
    /**
     * NEW: Loads a graph from the new human-readable format.
     */
    _loadReadableGraph(readableData) {
        this.resetState();
        const flatGraphs = {};
        const handleToNodeIdMap = new Map();

        this._convertReadableToState(readableData.graph, flatGraphs, handleToNodeIdMap);
        
        this.state.graphs = flatGraphs;

        const rootGraph = this.findGraphById('root');
        if (rootGraph) {
            rootGraph.name = readableData.title || 'Loaded Graph';
        }
        
        this.render();
    }

    /**
     * HELPER: Recursively traverses the readable graph format and flattens it into the editor's state.
     */
    _convertReadableToState(readableGraph, flatGraphs, handleToNodeIdMap) {
        const newGraph = {
            id: readableGraph.id,
            name: readableGraph.name,
            pan: { ...readableGraph.pan },
            zoom: readableGraph.zoom,
            nodes: [],
            connections: []
        };

        readableGraph.nodes.forEach(readableNode => {
            const newNode = JSON.parse(JSON.stringify(readableNode));
            const internalNodeId = `node_${this.state.nodeCounter++}`;
            handleToNodeIdMap.set(readableNode.id, internalNodeId);
            newNode.id = internalNodeId;

            if (newNode.subgraph) {
                const subgraph = newNode.subgraph;
                newNode.subgraphId = subgraph.id;
                this._convertReadableToState(subgraph, flatGraphs, handleToNodeIdMap);
                delete newNode.subgraph;
            }
            newGraph.nodes.push(newNode);
        });

        readableGraph.connections.forEach(readableConn => {
            const startNodeId = handleToNodeIdMap.get(readableConn.from);
            const endNodeId = handleToNodeIdMap.get(readableConn.to);
            const startNode = newGraph.nodes.find(n => n.id === startNodeId);
            const endNode = newGraph.nodes.find(n => n.id === endNodeId);

            if (startNode && endNode) {
                const startIndex = startNode.outputs.findIndex(o => o.name === readableConn.from_pin);
                const endIndex = endNode.inputs.findIndex(i => i.name === readableConn.to_pin);
                
                if (startIndex !== -1 && endIndex !== -1) {
                    newGraph.connections.push({
                        id: readableConn.id || `conn_${Date.now()}_${Math.random()}`,
                        start: { nodeId: startNodeId, index: startIndex },
                        end: { nodeId: endNodeId, index: endIndex }
                    });
                }
            }
        });
        
        flatGraphs[newGraph.id] = newGraph;
    }

    // ----- LEGACY & UTILITY METHODS -----
    
    /**
     * RETAINED for backward compatibility: Loads a graph from the legacy simplified JSON object.
     */
    _loadLegacySimpleGraph(simpleData) {
        this.resetState();
        const rootGraph = this.getCurrentGraph();
        rootGraph.name = simpleData.title || 'Loaded Graph';
        this._convertLegacySimpleToGraph(simpleData.story, rootGraph);
        this.render();
    }

    /**
     * RETAINED for backward compatibility: The original conversion logic for the legacy format.
     */
    _convertLegacySimpleToGraph(simpleNodesArray, targetGraph) {
        const simpleIdToNodeIdMap = new Map();
        const usedSimpleIds = new Set();

        simpleNodesArray.forEach(simpleNode => {
            let runtimeId = simpleNode.id;
            if (!runtimeId || usedSimpleIds.has(runtimeId)) {
                runtimeId = this._generateUniqueHandle(simpleNode.name, usedSimpleIds);
            }
            usedSimpleIds.add(runtimeId);
            simpleNode._runtimeId = runtimeId;
        });
        
        const layout = { x: 50, y: 50, columnWidth: NODE_MIN_WIDTH + 80, rowHeight: NODE_MIN_HEIGHT + 60, maxCols: 4 };
        let col = 0, row = 0;

        simpleNodesArray.forEach(simpleNode => {
            const editorNodeId = `node_${this.state.nodeCounter++}`;
            simpleIdToNodeIdMap.set(simpleNode._runtimeId, editorNodeId);

            const nodeData = {
                id: editorNodeId,
                title: simpleNode.name,
                text: simpleNode.text || '',
                x: layout.x + col * layout.columnWidth,
                y: layout.y + row * layout.rowHeight,
                width: NODE_MIN_WIDTH,
                height: NODE_MIN_HEIGHT,
                color: 'default',
                type: 'default',
                inputs: [{ name: 'input', color: COLORS.default }],
                outputs: [],
                subgraphId: null,
            };

            col++;
            if (col >= layout.maxCols) { col = 0; row++; }

            if (simpleNode.branches) {
                nodeData.outputs = Object.keys(simpleNode.branches).map(branchName => ({
                    name: branchName, color: COLORS.default
                }));
            }

            if (simpleNode.logic && Array.isArray(simpleNode.logic)) {
                const subgraphId = `graph_${editorNodeId}`;
                nodeData.subgraphId = subgraphId;
                const subgraph = {
                    id: subgraphId, name: simpleNode.name, nodes: [], connections: [],
                    pan: { x: 0, y: 0 }, zoom: 1
                };
                this.state.graphs[subgraphId] = subgraph;
                this._convertLegacySimpleToGraph(simpleNode.logic, subgraph);
            }
            targetGraph.nodes.push(nodeData);
        });

        simpleNodesArray.forEach(simpleNode => {
            const startNodeId = simpleIdToNodeIdMap.get(simpleNode._runtimeId);
            if (!startNodeId || !simpleNode.branches) return;
            const startNodeData = this.findNodeById(startNodeId, targetGraph.id);

            for (const [branchName, targetSimpleId] of Object.entries(simpleNode.branches)) {
                const endNodeId = simpleIdToNodeIdMap.get(targetSimpleId);
                const outputIndex = startNodeData.outputs.findIndex(o => o.name === branchName);

                if (endNodeId != null && outputIndex !== -1) {
                    const connection = {
                        id: `conn_${Date.now()}_${Math.random()}`,
                        start: { nodeId: startNodeId, index: outputIndex },
                        end: { nodeId: endNodeId, index: 0 }
                    };
                    targetGraph.connections.push(connection);
                }
            }
        });
    }

    /**
     * RETAINED: Helper to generate a unique, URL-friendly handle from a string.
     */
    _generateUniqueHandle(baseName, existingHandles) {
        let handle = (baseName || 'unnamed-node').toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-');
        if (!handle) { handle = 'unnamed-node'; }

        let finalHandle = handle;
        let counter = 1;
        while (existingHandles.has(finalHandle)) {
            counter++;
            finalHandle = `${handle}-${counter}`;
        }
        return finalHandle;
    }

    // ----- EVENT HANDLERS & INTERACTIONS -----

    _onCanvasContentInput(e) {
        if (e.target.classList.contains('node-text')) {
            const nodeId = e.target.closest('.node')?.dataset.nodeId;
            if (nodeId) {
                this.updateNodeProperty(nodeId, 'text', e.target.value, e.target);
            }
        }
    }

    _onCanvasMouseDown(e) {
        this.interaction.didDrag = false;
        const target = e.target;
        if (target.classList.contains('node-header') || target.classList.contains('node-content') || target.classList.contains('node-text')) {
            this._startNodeDrag(e, target.closest('.node').dataset.nodeId);
        } else if (target.classList.contains('resize-handle')) {
            this._startNodeResize(e, target.dataset.nodeId);
        } else if (target.classList.contains('connection-point')) {
            this._startConnection(e, target);
        } else if (target === this.canvas || target === this.canvasContent) {
            if (e.button === 0) {
                this._startSelectionBox(e);
            } else if (e.button === 2) {
                this._startPan(e);
            }
        }
    }

    _onMouseMove(e) {
        if (this.interaction.isDragging || this.interaction.isSelecting || this.interaction.isPanning) {
            this.interaction.didDrag = true;
        }

        const graph = this.getCurrentGraph();
        const mousePos = this.getCanvasCoordinates(e.clientX, e.clientY);

        if (this.interaction.isResizing) {
            const dx = (e.clientX - this.interaction.panStart.x) / graph.zoom;
            const dy = (e.clientY - this.interaction.panStart.y) / graph.zoom;
            const node = this.interaction.resizeNode;

            const newWidth = this.snapToGrid(Math.max(NODE_MIN_WIDTH, node.startWidth + dx));
            const newHeight = this.snapToGrid(Math.max(NODE_MIN_HEIGHT, node.startHeight + dy));

            const nodeData = this.findNodeById(node.id);
            nodeData.width = newWidth;
            nodeData.height = newHeight;

            const nodeEl = this.canvasContent.querySelector(`[data-node-id="${node.id}"]`);
            nodeEl.style.width = newWidth + 'px';
            nodeEl.style.height = newHeight + 'px';
            this.updateAllConnectionPaths();
        }
        else if (this.interaction.isDragging) {
            this.interaction.draggedNodes.forEach(dragged => {
                const nodeData = this.findNodeById(dragged.id);
                const x = this.snapToGrid(mousePos.x - dragged.offsetX);
                const y = this.snapToGrid(mousePos.y - dragged.offsetY);
                nodeData.x = x;
                nodeData.y = y;

                const nodeEl = this.canvasContent.querySelector(`[data-node-id="${dragged.id}"]`);
                nodeEl.style.left = x + 'px';
                nodeEl.style.top = y + 'px';
            });
            this.updateAllConnectionPaths();
        }
        else if (this.interaction.isPanning) {
            const dx = e.clientX - this.interaction.lastMousePosition.x;
            const dy = e.clientY - this.interaction.lastMousePosition.y;
            graph.pan.x += dx;
            graph.pan.y += dy;
            this.interaction.lastMousePosition = { x: e.clientX, y: e.clientY };
            this._renderCanvas();
        }
        else if (this.interaction.isSelecting) {
            const start = this.interaction.selectionStart;
            const left = Math.min(start.x, mousePos.x);
            const top = Math.min(start.y, mousePos.y);
            const width = Math.abs(mousePos.x - start.x);
            const height = Math.abs(mousePos.y - start.y);
            this.selectionBox.style.left = `${left}px`;
            this.selectionBox.style.top = `${top}px`;
            this.selectionBox.style.width = `${width}px`;
            this.selectionBox.style.height = `${height}px`;
        }
        else if (this.interaction.isConnecting) {
            const tempLine = this.canvasContent.querySelector('.connection-line.active');
            if (!tempLine) return;

            const startPoint = this.interaction.connectionStartPoint;
            const startNodeEl = this.canvasContent.querySelector(`[data-node-id="${startPoint.nodeId}"]`);
            const startNodeData = this.findNodeById(startPoint.nodeId);

            const startX = startNodeData.x + (startPoint.type === 'output' ? startNodeEl.offsetWidth : 0);
            const startY = startNodeData.y + CONNECTION_POINT_Y_OFFSET + (parseInt(startPoint.index) * CONNECTION_POINT_Y_SPACING) + 8;

            const path = tempLine.querySelector('path');
            const controlOffset = Math.abs(mousePos.x - startX) * 0.5;
            const pathData = `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${mousePos.x - controlOffset} ${mousePos.y} ${mousePos.x} ${mousePos.y}`;
            path.setAttribute('d', pathData);
        }
    }

    _onMouseUp(e) {
        if (this.interaction.isDragging) {
            this.interaction.isDragging = false;
        }
        else if (this.interaction.isResizing) {
            this.interaction.isResizing = false;
        }
        else if (this.interaction.isPanning) {
            this.canvas.classList.remove('panning');
            this.interaction.isPanning = false;
        }
        else if (this.interaction.isSelecting) {
            this.interaction.isSelecting = false;
            this.selectionBox.style.display = 'none';

            const box = {
                left: parseInt(this.selectionBox.style.left),
                top: parseInt(this.selectionBox.style.top),
                right: parseInt(this.selectionBox.style.left) + parseInt(this.selectionBox.style.width),
                bottom: parseInt(this.selectionBox.style.top) + parseInt(this.selectionBox.style.height)
            };
            this.selectNodesInBox(box);
        }
        else if (this.interaction.isConnecting) {
            const tempLine = this.canvasContent.querySelector('.connection-line.active');
            if (tempLine) tempLine.remove();

            const endTarget = e.target;
            if (endTarget.classList.contains('connection-point')) {
                this._finishConnection(this.interaction.connectionStartPoint, endTarget.dataset);
            }
            this.interaction.isConnecting = false;
            this.interaction.connectionStartPoint = null;
        }
    }

    _onGlobalClick(e) {
        if (this.interaction.didDrag) {
            return;
        }

        const target = e.target;

        if (!this.contextMenu.contains(target)) this.contextMenu.style.display = 'none';
        if (!this.connectionContextMenu.contains(target)) this.connectionContextMenu.style.display = 'none';

        if (target === this.canvas || target === this.canvasContent) {
            this.clearSelection();
        }

        const nodeEl = target.closest('.node');
        if (nodeEl && !target.classList.contains('node-text')) {
            const nodeId = nodeEl.dataset.nodeId;
            if (e.detail === 1) {
                if (!this.interaction.isDragging) {
                    if (e.ctrlKey || e.shiftKey) {
                        if (this.state.selectedNodeIds.has(nodeId)) {
                            this.state.selectedNodeIds.delete(nodeId);
                        } else {
                            this.state.selectedNodeIds.add(nodeId);
                        }
                    } else {
                        if (!this.state.selectedNodeIds.has(nodeId)) {
                            this.state.selectedNodeIds.clear();
                            this.state.selectedNodeIds.add(nodeId);
                        }
                    }
                    this.render();
                }
            } else if (e.detail === 2) {
                this.enterNode(nodeId);
            }
        }

        const path = e.target.closest('path[data-connection-id]');
        if (path) {
            this.state.selectedConnectionId = path.dataset.connectionId;
            this.connectionContextMenu.style.left = `${e.clientX}px`;
            this.connectionContextMenu.style.top = `${e.clientY}px`;
            this.connectionContextMenu.style.display = 'block';
        }
    }

    _onCanvasWheel(e) {
        e.preventDefault();
        const graph = this.getCurrentGraph();
        const canvasRect = this.canvas.getBoundingClientRect();
        const mousePos = {
            x: e.clientX - canvasRect.left,
            y: e.clientY - canvasRect.top
        };

        const oldZoom = graph.zoom;
        const zoomChange = e.deltaY < 0 ? ZOOM_SENSITIVITY : -ZOOM_SENSITIVITY;
        graph.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom + zoomChange));

        const zoomRatio = graph.zoom / oldZoom;
        graph.pan.x = mousePos.x - (mousePos.x - graph.pan.x) * zoomRatio;
        graph.pan.y = mousePos.y - (mousePos.y - graph.pan.y) * zoomRatio;

        this._renderCanvas();
    }

    _onCanvasContextMenu(e) {
        e.preventDefault();
        if (this.interaction.isPanning) return;
        const dx = Math.abs(e.clientX - this.interaction.panStart.x);
        const dy = Math.abs(e.clientY - this.interaction.panStart.y);
        if (dx > 4 || dy > 4) return;

        this.contextMenu.style.left = `${e.clientX}px`;
        this.contextMenu.style.top = `${e.clientY}px`;
        this.contextMenu.style.display = 'block';

        this.state.contextMenuTarget = this.getCanvasCoordinates(e.clientX, e.clientY);

        const atRoot = this.state.navigationStack.length === 1;
        this.contextMenu.querySelector('[data-action="add-graph-input"]').classList.toggle('disabled', atRoot);
        this.contextMenu.querySelector('[data-action="add-graph-output"]').classList.toggle('disabled', atRoot);
    }

    _onContextMenuClick(e) {
        const action = e.target.dataset.action;
        if (!action || e.target.classList.contains('disabled')) return;

        switch (action) {
            case 'add-node':
                this.addNode('default', this.state.contextMenuTarget);
                break;
            case 'add-graph-input':
                this.addNode('graph-input', this.state.contextMenuTarget);
                break;
            case 'add-graph-output':
                this.addNode('graph-output', this.state.contextMenuTarget);
                break;
            case 'delete-connection':
                if (this.state.selectedConnectionId) {
                    const graph = this.getCurrentGraph();
                    graph.connections = graph.connections.filter(c => c.id !== this.state.selectedConnectionId);
                    this.state.selectedConnectionId = null;
                    this.render();
                }
                break;
        }

        this.contextMenu.style.display = 'none';
        this.connectionContextMenu.style.display = 'none';
    }

    _onKeyDown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'c': e.preventDefault(); this.copySelectedNodes(); break;
                case 'v': e.preventDefault(); this.pasteNodes(); break;
                case 'a':
                    e.preventDefault();
                    const graph = this.getCurrentGraph();
                    graph.nodes.forEach(node => this.state.selectedNodeIds.add(node.id));
                    this.render();
                    break;
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            this.deleteSelected();
        } else if (e.key === 'Escape') {
            this.clearSelection();
        }
    }

    _startNodeDrag(e, nodeId) {
        if (e.target.classList.contains('node-text')) {
            return;
        }
        e.stopPropagation();
        this.interaction.isDragging = true;
        const mousePos = this.getCanvasCoordinates(e.clientX, e.clientY);

        if (!this.state.selectedNodeIds.has(nodeId)) {
            if (!e.ctrlKey && !e.shiftKey) {
                this.state.selectedNodeIds.clear();
            }
            this.state.selectedNodeIds.add(nodeId);
            this.render();
        }

        this.interaction.draggedNodes = [];
        this.state.selectedNodeIds.forEach(id => {
            const node = this.findNodeById(id);
            if (node) {
                this.interaction.draggedNodes.push({
                    id: id,
                    offsetX: mousePos.x - node.x,
                    offsetY: mousePos.y - node.y
                });
            }
        });
    }

    _startNodeResize(e, nodeId) {
        e.stopPropagation();
        this.interaction.isResizing = true;
        const nodeData = this.findNodeById(nodeId);

        this.interaction.resizeNode = {
            id: nodeId,
            startWidth: nodeData.width,
            startHeight: nodeData.height
        };
        this.interaction.panStart = { x: e.clientX, y: e.clientY };
    }

    _startPan(e) {
        e.preventDefault();
        this.interaction.isPanning = true;
        this.canvas.classList.add('panning');
        this.interaction.panStart = { x: e.clientX, y: e.clientY };
        this.interaction.lastMousePosition = { x: e.clientX, y: e.clientY };
    }

    _startSelectionBox(e) {
        if (!e.ctrlKey && !e.shiftKey) {
            this.clearSelection();
        }
        this.interaction.isSelecting = true;
        this.interaction.selectionStart = this.getCanvasCoordinates(e.clientX, e.clientY);

        this.selectionBox.style.left = `${this.interaction.selectionStart.x}px`;
        this.selectionBox.style.top = `${this.interaction.selectionStart.y}px`;
        this.selectionBox.style.width = '0px';
        this.selectionBox.style.height = '0px';
        this.selectionBox.style.display = 'block';
    }

    _startConnection(e, startPointEl) {
        e.stopPropagation();
        this.interaction.isConnecting = true;
        this.interaction.connectionStartPoint = { ...startPointEl.dataset };

        const line = document.createElement('div');
        line.className = 'connection-line active';
        line.innerHTML = `<svg><path style="stroke:#4a9eff; stroke-width:4; fill:none;"></path></svg>`;
        this.canvasContent.appendChild(line);
    }

    _finishConnection(startPointData, endPointData) {
        if (startPointData.nodeId === endPointData.nodeId || startPointData.type === endPointData.type) {
            return;
        }

        const graph = this.getCurrentGraph();

        const outputData = startPointData.type === 'output' ? startPointData : endPointData;
        const inputData = startPointData.type === 'input' ? startPointData : endPointData;

        // Prevent duplicate connections
        const exists = graph.connections.some(c =>
            c.start.nodeId === outputData.nodeId &&
            c.start.index === parseInt(outputData.index) &&
            c.end.nodeId === inputData.nodeId &&
            c.end.index === parseInt(inputData.index)
        );

        if (exists) return;

        const connection = {
            id: `conn_${Date.now()}`,
            start: {
                nodeId: outputData.nodeId,
                index: parseInt(outputData.index)
            },
            end: {
                nodeId: inputData.nodeId,
                index: parseInt(inputData.index)
            }
        };

        graph.connections.push(connection);
        this.render();
    }
}

window.nodeEditor = new NodeEditor('canvas');