// =================================================================
// Constants & Configuration
// =================================================================

const GRID_SIZE = 32;
const NODE_MIN_WIDTH = 256;
const NODE_MIN_HEIGHT = 128;
const CONNECTION_POINT_Y_OFFSET = 32;
const CONNECTION_POINT_Y_SPACING = 32;
const ZOOM_SENSITIVITY = 0.1;
const MAX_ZOOM = 3;
const MIN_ZOOM = 0.2;

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

// =================================================================
// Main Application Class
// =================================================================

class NodeEditor {
    constructor(canvasId) {
        // --- DOM Element References ---
        this.canvas = document.getElementById(canvasId);
        this.canvasContent = document.getElementById('canvasContent');
        this.selectionBox = document.getElementById('selectionBox');
        this.propertiesPanel = document.getElementById('propertiesPanel');
        this.propertiesContent = document.getElementById('propertiesContent');
        this.contextMenu = document.getElementById('contextMenu');
        this.connectionContextMenu = document.getElementById('connectionContextMenu');
        
        // --- State Management ---
        // We consolidate all state into a single object for clarity.
        this.state = this.getInitialState();

        // --- Interaction State ---
        // These properties track the state of ongoing user interactions.
        this.interaction = {
            isDragging: false,
            isResizing: false,
            isPanning: false,
            isConnecting: false,
            isSelecting: false,
            draggedNodes: [],
            resizeNode: null,
            connectionStartPoint: null,
            panStart: { x: 0, y: 0 },
            selectionStart: { x: 0, y: 0 },
            lastMousePosition: { x: 0, y: 0 },
        };
        
        this.initialize();
    }

    /**
     * Sets up the initial state of the editor and binds all event listeners.
     */
    initialize() {
        this.resetState();
        this._bindEventListeners();
        this.render();
    }

    /**
     * Creates the default state for the application.
     * @returns {object} The initial state object.
     */
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
    
    /**
     * Resets the state to its initial values.
     */
    resetState() {
        this.state = this.getInitialState();
    }
    
    // =================================================================
    // Event Listener Binding
    // =================================================================

    /**
     * Binds all necessary event listeners for the editor.
     * This centralizes event handling setup.
     */
    _bindEventListeners() {
        // Canvas interactions
        this.canvas.addEventListener('mousedown', this._onCanvasMouseDown.bind(this));
        this.canvas.addEventListener('wheel', this._onCanvasWheel.bind(this));
        this.canvas.addEventListener('contextmenu', this._onCanvasContextMenu.bind(this));
        
        // Listen for input on textareas within the canvas (for in-node editing)
        this.canvasContent.addEventListener('input', this._onCanvasContentInput.bind(this));

        // Global mouse movements and releases
        document.addEventListener('mousemove', this._onMouseMove.bind(this));
        document.addEventListener('mouseup', this._onMouseUp.bind(this));
        
        // Global clicks for closing menus/deselecting
        document.addEventListener('click', this._onGlobalClick.bind(this));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this._onKeyDown.bind(this));

        // Toolbar buttons
        document.getElementById('addNodeBtn').addEventListener('click', () => this.addNode());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveGraph());
        document.getElementById('loadBtn').addEventListener('click', () => document.getElementById('loadFile').click());
        document.getElementById('loadFile').addEventListener('change', (e) => this.loadGraph(e));
        document.getElementById('copyBtn').addEventListener('click', () => this.copySelectedNodes());
        document.getElementById('pasteBtn').addEventListener('click', () => this.pasteNodes());
        document.getElementById('deleteBtn').addEventListener('click', () => this.deleteSelected());
        
        // Context Menus
        this.contextMenu.addEventListener('click', this._onContextMenuClick.bind(this));
        this.connectionContextMenu.addEventListener('click', this._onContextMenuClick.bind(this));
    }

    // =================================================================
    // State & Data Accessors
    // =================================================================
    
    /**
     * Gets the currently active graph object from the state.
     * @returns {object} The current graph.
     */
    getCurrentGraph() {
        const currentGraphId = this.state.navigationStack[this.state.navigationStack.length - 1];
        return this.state.graphs[currentGraphId];
    }
    
    /**
     * Finds a node by its ID in the specified graph.
     * @param {string} nodeId - The ID of the node to find.
     * @param {string} [graphId=current] - The ID of the graph to search in.
     * @returns {object|undefined} The node data object.
     */
    findNodeById(nodeId, graphId = null) {
        const graph = graphId ? this.state.graphs[graphId] : this.getCurrentGraph();
        return graph ? graph.nodes.find(n => n.id === nodeId) : undefined;
    }
    
    /**
     * Finds a graph by its ID.
     * @param {string} graphId - The ID of the graph to find.
     * @returns {object|undefined} The graph data object.
     */
    findGraphById(graphId) {
        return this.state.graphs[graphId];
    }

    // =================================================================
    // Core Rendering Logic
    // =================================================================

    /**
     * The main render function. It orchestrates the drawing of the entire UI
     * based on the current state.
     */
    render() {
        this._renderCanvas();
        this._renderToolbar();
        this._renderPropertiesPanel();
    }
    
    /**
     * Renders the main canvas content: nodes and connections.
     */
    _renderCanvas() {
        const graph = this.getCurrentGraph();
        
        // Store scroll positions of textareas to restore them after re-render
        const textScrolls = {};
        this.canvasContent.querySelectorAll('.node-text').forEach(ta => {
            const nodeId = ta.closest('.node').dataset.nodeId;
            textScrolls[nodeId] = { top: ta.scrollTop, left: ta.scrollLeft };
        });
        
        // Clear previous content
        this.canvasContent.innerHTML = '<div class="selection-box" id="selectionBox"></div>';
        this.selectionBox = document.getElementById('selectionBox'); // Re-assign after clearing

        // Update canvas transform (pan & zoom)
        const transform = `translate(${graph.pan.x}px, ${graph.pan.y}px) scale(${graph.zoom})`;
        this.canvasContent.style.transform = transform;
        
        // Update grid background
        const gridSize = GRID_SIZE * graph.zoom;
        this.canvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
        this.canvas.style.backgroundPosition = `${graph.pan.x % gridSize}px ${graph.pan.y % gridSize}px`;

        // Render nodes and connections
        graph.nodes.forEach(nodeData => this._renderNode(nodeData));
        graph.connections.forEach(connData => this._renderConnection(connData));

        // Restore scroll positions
        Object.keys(textScrolls).forEach(nodeId => {
            const textarea = this.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-text`);
            if (textarea) {
                textarea.scrollTop = textScrolls[nodeId].top;
                textarea.scrollLeft = textScrolls[nodeId].left;
            }
        });
    }
    
    /**
     * Creates and appends a single node element to the canvas.
     * @param {object} nodeData - The data for the node to render.
     */
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

        let innerHTML = `
            <div class="node-header">${nodeData.title}</div>
            <div class="node-content">
                <textarea class="node-text" placeholder="Enter text..." ${nodeData.type !== 'default' ? 'readonly' : ''}>${nodeData.text}</textarea>
            </div>
        `;
        
        if (nodeData.type === 'default') {
            innerHTML += `<div class="resize-handle" data-node-id="${nodeData.id}"></div>`;
        }

        nodeEl.innerHTML = innerHTML;
        this.canvasContent.appendChild(nodeEl);
        
        this._renderNodeConnectionPoints(nodeEl, nodeData);
    }

    /**
     * Renders the input and output connection points for a node.
     * @param {HTMLElement} nodeEl - The DOM element of the node.
     * @param {object} nodeData - The data for the node.
     */
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
        const contentMinHeight = (maxIO > 0) ? (maxIO * CONNECTION_POINT_Y_SPACING + 20) : 0;
        nodeEl.querySelector('.node-content').style.minHeight = `${contentMinHeight}px`;
    }
    
    /**
     * Renders a single connection line (SVG path) on the canvas.
     * @param {object} connData - The data for the connection.
     */
    _renderConnection(connData) {
        const startNode = this.findNodeById(connData.start.nodeId);
        const endNode = this.findNodeById(connData.end.nodeId);

        if (!startNode || !endNode) return; // Don't render if nodes don't exist
        
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
        path.dataset.connectionId = connData.id; // For event delegation

        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);
        svg.appendChild(defs);
        svg.appendChild(path);
        line.appendChild(svg);
        this.canvasContent.appendChild(line);
        
        this.updateConnectionPath(connData.id);
    }
    
    /**
     * Renders the toolbar, updating button states and breadcrumbs.
     */
    _renderToolbar() {
        // Update button disabled states
        document.getElementById('copyBtn').disabled = this.state.selectedNodeIds.size === 0;
        document.getElementById('pasteBtn').disabled = this.state.copiedNodes.length === 0;
        document.getElementById('deleteBtn').disabled = this.state.selectedNodeIds.size === 0;
        
        // Update selected count
        const count = this.state.selectedNodeIds.size;
        const countEl = document.getElementById('selectedCount');
        countEl.textContent = count > 0 ? `${count} node${count > 1 ? 's' : ''} selected` : '';

        // Update breadcrumbs
        const breadcrumbsContainer = document.getElementById('breadcrumbs');
        breadcrumbsContainer.innerHTML = '';
        this.state.navigationStack.forEach((graphId, index) => {
            const graph = this.findGraphById(graphId);
            if (!graph) return;

            const item = document.createElement('span');
            item.textContent = graph.name;
            item.className = 'breadcrumb-item';

            if (index === this.state.navigationStack.length - 1) {
                item.classList.add('active');
            } else {
                item.onclick = () => this.navigateToLevel(index);
            }
            breadcrumbsContainer.appendChild(item);

            if (index < this.state.navigationStack.length - 1) {
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '>';
                breadcrumbsContainer.appendChild(separator);
            }
        });
    }

    /**
     * Renders the properties panel based on the current selection.
     */
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
            html = `
                <div class="property-group">
                    <label>Node Title:</label>
                    <input type="text" id="propNodeTitle" value="${nodeData.title}" data-node-id="${nodeId}">
                </div>
                <div class="property-group">
                    <label>Text Content:</label>
                    <textarea id="propNodeContent" rows="4" data-node-id="${nodeId}" ${isIoNode ? 'readonly' : ''}>${nodeData.text}</textarea>
                </div>
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
        
        // Add event listeners for the input fields
        const titleInput = document.getElementById('propNodeTitle');
        const contentInput = document.getElementById('propNodeContent');
        if (titleInput) {
            titleInput.addEventListener('input', (e) => this.updateNodeProperty(e.target.dataset.nodeId, 'title', e.target.value, e.target));
        }
        if (contentInput) {
            contentInput.addEventListener('input', (e) => this.updateNodeProperty(e.target.dataset.nodeId, 'text', e.target.value, e.target));
        }
    }
    
    // =================================================================
    // Update & Calculation Helpers
    // =================================================================

    /**
     * Recalculates and updates the SVG path for a given connection.
     * @param {string} connectionId - The ID of the connection to update.
     */
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
        const startY = startNodeData.y + CONNECTION_POINT_Y_OFFSET + (connection.start.index * CONNECTION_POINT_Y_SPACING) + 7;
        const endX = this.findNodeById(connection.end.nodeId).x;
        const endY = this.findNodeById(connection.end.nodeId).y + CONNECTION_POINT_Y_OFFSET + (connection.end.index * CONNECTION_POINT_Y_SPACING) + 7;
        
        const path = line.querySelector('path');
        const controlOffset = Math.abs(endX - startX) * 0.5;
        const pathData = `M ${startX} ${startY} C ${startX + controlOffset} ${startY} ${endX - controlOffset} ${endY} ${endX} ${endY}`;
        path.setAttribute('d', pathData);

        // Update gradient coordinates
        const gradient = line.querySelector('linearGradient');
        if (gradient) {
            gradient.setAttribute('x1', startX);
            gradient.setAttribute('y1', startY);
            gradient.setAttribute('x2', endX);
            gradient.setAttribute('y2', endY);
        }
    }
    
    /**
     * Updates all connection paths in the current view.
     */
    updateAllConnectionPaths() {
        const graph = this.getCurrentGraph();
        graph.connections.forEach(conn => this.updateConnectionPath(conn.id));
    }
    
    /**
     * Converts screen coordinates to canvas-space coordinates.
     * @param {number} clientX - The mouse X position on the screen.
     * @param {number} clientY - The mouse Y position on the screen.
     * @returns {object} {x, y} coordinates in the canvas space.
     */
    getCanvasCoordinates(clientX, clientY) {
        const graph = this.getCurrentGraph();
        const canvasRect = this.canvas.getBoundingClientRect();
        const x = (clientX - canvasRect.left - graph.pan.x) / graph.zoom;
        const y = (clientY - canvasRect.top - graph.pan.y) / graph.zoom;
        return { x, y };
    }

    /**
     * Snaps a value to the nearest grid line.
     * @param {number} value - The value to snap.
     * @returns {number} The snapped value.
     */
    snapToGrid(value) {
        return Math.round(value / GRID_SIZE) * GRID_SIZE;
    }
    
    /**
     * Updates the inputs/outputs of a parent node when its subgraph's
     * Input/Output nodes change.
     */
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
        
        // This method only updates the data model. A re-render is required to see changes.
    }


    // =================================================================
    // User Action Handlers
    // =================================================================

    /**
     * Adds a new node to the current graph.
     * @param {string} [type='default'] - The type of node to add.
     * @param {object} [position=null] - The {x, y} position to add the node at.
     */
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

        // Customize node based on type
        switch (type) {
            case 'default':
                nodeData.title = `Node ${this.state.nodeCounter - 1}`;
                // Create a new subgraph for this node
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
                nodeData.text = 'Defines an input for the parent graph.';
                nodeData.color = 'cyan';
                nodeData.outputs = [{ name: 'Value', color: COLORS.cyan }];
                break;
            case 'graph-output':
                nodeData.title = 'Output';
                nodeData.text = 'Defines an output for the parent graph.';
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
    
    /**
     * Deletes all currently selected nodes and their connections.
     */
    deleteSelected() {
        if (this.state.selectedNodeIds.size === 0) return;
        const graph = this.getCurrentGraph();
        let ioNodeDeleted = false;

        // Remove nodes
        graph.nodes = graph.nodes.filter(node => {
            if (this.state.selectedNodeIds.has(node.id)) {
                if(node.type !== 'default') ioNodeDeleted = true;
                // Also delete any associated subgraph
                if(node.subgraphId) delete this.state.graphs[node.subgraphId];
                return false;
            }
            return true;
        });

        // Remove connections attached to deleted nodes
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
    
    /**
     * Clears the current node selection.
     */
    clearSelection() {
        if (this.state.selectedNodeIds.size > 0) {
            this.state.selectedNodeIds.clear();
            this.render();
        }
    }
    
    /**
     * Selects nodes that fall within a given rectangular area.
     * @param {object} box - The selection box with {left, top, right, bottom}.
     */
	selectNodesInBox(box) {
        const graph = this.getCurrentGraph();
        graph.nodes.forEach(node => {
            const nodeRect = {
                left: node.x,
                top: node.y,
                right: node.x + node.width,
                bottom: node.y + node.height,
            };
            // Check for intersection
            if (box.right > nodeRect.left && box.left < nodeRect.right && box.bottom > nodeRect.top && box.top < nodeRect.bottom) {
                this.state.selectedNodeIds.add(node.id);
            }
        });
        this.render();
    }

    /**
     * Updates a specific property of a node without a full re-render.
     * @param {string} nodeId - The ID of the node to update.
     * @param {string} property - The name of the property ('title' or 'text').
     * @param {*} value - The new value for the property.
     * @param {HTMLElement} [sourceElement=null] - The input element that triggered the update.
     */
    updateNodeProperty(nodeId, property, value, sourceElement = null) {
        const node = this.findNodeById(nodeId);
        if (!node) return;

        // 1. Update the state object. This is the source of truth.
        node[property] = value;

        // 2. Perform targeted DOM updates to sync the UI with the state,
        //    avoiding re-updating the element that triggered the change.

        if (property === 'title') {
            // Update the title in the node header on the canvas
            const nodeHeader = this.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-header`);
            if (nodeHeader && nodeHeader !== sourceElement) {
                nodeHeader.textContent = value;
            }

            // Update the title in the properties panel
            const propTitleInput = document.getElementById('propNodeTitle');
            if (propTitleInput && propTitleInput !== sourceElement) {
                propTitleInput.value = value;
            }

            // --- Handle side effects of a title change ---
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
                // This is a complex update. A full render is the simplest way to ensure
                // visual consistency, though it will cause defocus for this specific case.
                this.render(); 
            } else if (needsToolbarRender) {
                this._renderToolbar();
            }

        } else if (property === 'text') {
            // Update the text in the node's textarea on the canvas
            const nodeTextarea = this.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-text`);
            if (nodeTextarea && nodeTextarea !== sourceElement) {
                nodeTextarea.value = value;
            }
            
            // Update the text in the properties panel's textarea
            const propContentTextarea = document.getElementById('propNodeContent');
            if (propContentTextarea && propContentTextarea !== sourceElement) {
                propContentTextarea.value = value;
            }
        }
    }


    /**
     * Sets the color of a node and updates its connection points.
     * @param {string} nodeId - The ID of the node.
     * @param {string} colorName - The name of the color (e.g., 'red').
     */
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
        this.updateAllConnectionPaths(); // Must be called after render
    }
    
    /**
     * Navigates into a node's subgraph.
     * @param {string} nodeId - The ID of the node to enter.
     */
    enterNode(nodeId) {
        const node = this.findNodeById(nodeId);
        if (node && node.subgraphId) {
            this.state.navigationStack.push(node.subgraphId);
            this.clearSelection();
            this.render();
        }
    }
    
    /**
     * Navigates up the hierarchy to a specific level.
     * @param {number} level - The index in the navigation stack to go to.
     */
    navigateToLevel(level) {
        if (level >= this.state.navigationStack.length - 1) return;
        this.state.navigationStack = this.state.navigationStack.slice(0, level + 1);
        this.clearSelection();
        this.render();
    }
    
    // =================================================================
    // File I/O & Clipboard
    // =================================================================

    saveGraph() {
        // We only need to save the state, as it contains everything.
        const dataStr = JSON.stringify(this.state, (key, value) => {
            if (value instanceof Set) {
                return Array.from(value); // Convert Sets to Arrays for JSON
            }
            return value;
        }, 2);
        
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', 'refactored_graph.json');
        linkElement.click();
    }

    loadGraph(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const loadedState = JSON.parse(e.target.result);
                // Re-hydrate the state, converting arrays back to Sets
                loadedState.selectedNodeIds = new Set(loadedState.selectedNodeIds || []);
                this.state = loadedState;
                this.render();
            } catch (error) {
                alert('Error loading graph: ' + error.message);
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset file input
    }
    
    copySelectedNodes() {
        if (this.state.selectedNodeIds.size === 0) return;
        const graph = this.getCurrentGraph();
        
        this.state.copiedNodes = graph.nodes
            .filter(node => this.state.selectedNodeIds.has(node.id))
            .map(node => JSON.parse(JSON.stringify(node))); // Deep copy
            
        this._renderToolbar(); // Update paste button state
    }
    
    pasteNodes() {
        if (this.state.copiedNodes.length === 0) return;
        const graph = this.getCurrentGraph();
        this.clearSelection();

        this.state.copiedNodes.forEach(nodeData => {
            const newNode = JSON.parse(JSON.stringify(nodeData)); // Deep copy
            newNode.id = `node_${this.state.nodeCounter++}`;
            newNode.title += ' (Copy)';
            newNode.x += GRID_SIZE;
            newNode.y += GRID_SIZE;
            
            // If the copied node has a subgraph, we need to clone it too.
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

    // =================================================================
    // Event Handlers (_on... methods)
    // =================================================================

    _onCanvasContentInput(e) {
        // Handles text input for textareas inside nodes on the canvas
        if (e.target.classList.contains('node-text')) {
            const nodeId = e.target.closest('.node')?.dataset.nodeId;
            if (nodeId) {
                // Pass the element that triggered the event to avoid re-updating it
                this.updateNodeProperty(nodeId, 'text', e.target.value, e.target);
            }
        }
    }
    
    _onCanvasMouseDown(e) {
        const target = e.target;
        
        // Delegate based on the target element
        if (target.classList.contains('node-header') || target.classList.contains('node-content') || target.classList.contains('node-text')) {
            this._startNodeDrag(e, target.closest('.node').dataset.nodeId);
        } else if (target.classList.contains('resize-handle')) {
            this._startNodeResize(e, target.dataset.nodeId);
        } else if (target.classList.contains('connection-point')) {
            this._startConnection(e, target);
        } else if (target === this.canvas || target === this.canvasContent) {
            if (e.button === 0) { // Left-click
                this._startSelectionBox(e);
            } else if (e.button === 2) { // Right-click for panning
                this._startPan(e);
            }
        }
    }
    
    _onMouseMove(e) {
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
            
            // Partial render for performance
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
            this._renderCanvas(); // Re-render canvas for pan/zoom
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
             if(!tempLine) return;
             
             const startPoint = this.interaction.connectionStartPoint;
             const startNodeEl = this.canvasContent.querySelector(`[data-node-id="${startPoint.nodeId}"]`);
             const startNodeData = this.findNodeById(startPoint.nodeId);
             
             const startX = startNodeData.x + (startPoint.type === 'output' ? startNodeEl.offsetWidth : 0);
             const startY = startNodeData.y + CONNECTION_POINT_Y_OFFSET + (parseInt(startPoint.index) * CONNECTION_POINT_Y_SPACING) + 7;
             
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
            if(tempLine) tempLine.remove();
            
            const endTarget = e.target;
            if (endTarget.classList.contains('connection-point')) {
                this._finishConnection(this.interaction.connectionStartPoint, endTarget.dataset);
            }
            this.interaction.isConnecting = false;
            this.interaction.connectionStartPoint = null;
        }
    }
    
    _onGlobalClick(e) {
        const target = e.target;
        
        // Hide context menus if clicking outside
        if (!this.contextMenu.contains(target)) this.contextMenu.style.display = 'none';
        if (!this.connectionContextMenu.contains(target)) this.connectionContextMenu.style.display = 'none';
        
        // Clear selection if clicking on the background
        if (target === this.canvas || target === this.canvasContent) {
             this.clearSelection();
        }
        
        // Handle node selection
        const nodeEl = target.closest('.node');
        if (nodeEl && !target.classList.contains('node-text')) { // Prevent selection change when clicking textarea
            const nodeId = nodeEl.dataset.nodeId;
            if (e.detail === 1) { // Single click
                if (!this.interaction.isDragging) { // Don't re-select at the end of a drag
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
            } else if (e.detail === 2) { // Double click
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
        // Don't show menu if we just finished a pan
        if (this.interaction.isPanning) return;
        const dx = Math.abs(e.clientX - this.interaction.panStart.x);
        const dy = Math.abs(e.clientY - this.interaction.panStart.y);
        if (dx > 5 || dy > 5) return;
        
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
        
        switch(action) {
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
        // Ignore key events if an input field is focused
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

    // =================================================================
    // Interaction Start/End Helpers
    // =================================================================
    
    _startNodeDrag(e, nodeId) {
        // Prevent drag from starting if the target is the editable textarea
        if (e.target.classList.contains('node-text')) {
            return;
        }
        e.stopPropagation();
        this.interaction.isDragging = true;
        const mousePos = this.getCanvasCoordinates(e.clientX, e.clientY);
        
        // If the clicked node is not selected, clear selection and select it
        if (!this.state.selectedNodeIds.has(nodeId)) {
            this.state.selectedNodeIds.clear();
            this.state.selectedNodeIds.add(nodeId);
            this.render(); // Re-render to show selection
        }
        
        this.interaction.draggedNodes = [];
        this.state.selectedNodeIds.forEach(id => {
            const node = this.findNodeById(id);
            if(node) {
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
        this.interaction.connectionStartPoint = { ...startPointEl.dataset }; // Copy dataset
        
        // Create a temporary line for visual feedback
        const line = document.createElement('div');
        line.className = 'connection-line active';
        line.innerHTML = `<svg><path style="stroke:#4a9eff; stroke-width:3; fill:none;"></path></svg>`;
        this.canvasContent.appendChild(line);
    }
    
    _finishConnection(startPointData, endPointData) {
        // Validate connection
        if (startPointData.nodeId === endPointData.nodeId || startPointData.type === endPointData.type) {
            return;
        }

        const graph = this.getCurrentGraph();
        
        const outputData = startPointData.type === 'output' ? startPointData : endPointData;
        const inputData = startPointData.type === 'input' ? startPointData : endPointData;
        
        // Check if a connection already exists
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

// =================================================================
// Initialization
// =================================================================

// Expose the editor instance to the window for inline event handlers (like color selection)
// A more advanced approach would use event delegation for this.
window.nodeEditor = new NodeEditor('canvas');