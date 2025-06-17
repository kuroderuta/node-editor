// Constants
const CONFIG = {
    GRID_SIZE: 32,
    NODE_MIN_WIDTH: 256,
    NODE_MIN_HEIGHT: 128,
    CONNECTION_OFFSET: 32,
    CONNECTION_SPACING: 32,
    ZOOM_SENSITIVITY: 0.1,
    MAX_ZOOM: 4,
    MIN_ZOOM: 0.25,
    LAYOUT_PADDING_X: 350,
    LAYOUT_PADDING_Y: 200
};

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
        // DOM elements
        this.dom = {
            canvas: document.getElementById(canvasId),
            canvasContent: document.getElementById('canvasContent'),
            selectionBox: document.getElementById('selectionBox'),
            propertiesPanel: document.getElementById('propertiesPanel'),
            propertiesContent: document.getElementById('propertiesContent'),
            contextMenu: document.getElementById('contextMenu'),
            connectionContextMenu: document.getElementById('connectionContextMenu'),
            breadcrumbs: document.getElementById('breadcrumbs'),
            selectedCount: document.getElementById('selectedCount'),
            copyBtn: document.getElementById('copyBtn'),
            pasteBtn: document.getElementById('pasteBtn'),
            deleteBtn: document.getElementById('deleteBtn')
        };

        // Initialize state
        this.resetState();
        
        // Interaction state
        this.interaction = {
            mode: null, // 'drag', 'resize', 'pan', 'connect', 'select'
            data: {},
            didMove: false
        };

        this.init();
    }

    init() {
        this.bindEvents();
        this.render();
    }

    resetState() {
        const rootGraph = {
            id: 'root',
            name: 'Root',
            nodes: [],
            connections: [],
            pan: { x: 0, y: 0 },
            zoom: 1
        };

        this.state = {
            graphs: { root: rootGraph },
            navigationStack: ['root'],
            nodeCounter: 1,
            selectedNodeIds: new Set(),
            copiedNodes: [],
            contextMenuPos: null,
            selectedConnectionId: null
        };
    }

    // ===== Getters & Utilities =====
    
    get currentGraph() {
        return this.state.graphs[this.state.navigationStack.at(-1)];
    }

    findNode(nodeId, graphId = null) {
        const graph = graphId ? this.state.graphs[graphId] : this.currentGraph;
        return graph?.nodes.find(n => n.id === nodeId);
    }

    getCanvasCoords(clientX, clientY) {
        const rect = this.dom.canvas.getBoundingClientRect();
        const g = this.currentGraph;
        return {
            x: (clientX - rect.left - g.pan.x) / g.zoom,
            y: (clientY - rect.top - g.pan.y) / g.zoom
        };
    }

    snap(value) {
        return Math.round(value / CONFIG.GRID_SIZE) * CONFIG.GRID_SIZE;
    }

    // ===== Event Binding =====
    
    bindEvents() {
        // Canvas events
        const canvas = this.dom.canvas;
        canvas.addEventListener('mousedown', e => this.onMouseDown(e));
        canvas.addEventListener('wheel', e => this.onWheel(e));
        canvas.addEventListener('contextmenu', e => this.onContextMenu(e));

        // Global events
        document.addEventListener('mousemove', e => this.onMouseMove(e));
        document.addEventListener('mouseup', e => this.onMouseUp(e));
        document.addEventListener('click', e => this.onClick(e));
        document.addEventListener('keydown', e => this.onKeyDown(e));

        // Input events
        this.dom.canvasContent.addEventListener('input', e => {
            if (e.target.classList.contains('node-text')) {
                const nodeId = e.target.closest('.node')?.dataset.nodeId;
                if (nodeId) this.updateNodeProp(nodeId, 'text', e.target.value, e.target);
            }
        });

        // Button events
        document.getElementById('addNodeBtn').onclick = () => this.addNode();
        document.getElementById('saveBtn').onclick = () => this.saveGraph();
        document.getElementById('saveSimpleBtn').onclick = () => this.saveSimpleGraph();
        document.getElementById('loadBtn').onclick = () => document.getElementById('loadFile').click();
        document.getElementById('loadFile').onchange = e => this.loadGraph(e);
        this.dom.copyBtn.onclick = () => this.copySelected();
        this.dom.pasteBtn.onclick = () => this.pasteNodes();
        this.dom.deleteBtn.onclick = () => this.deleteSelected();

        // Context menu events
        [this.dom.contextMenu, this.dom.connectionContextMenu].forEach(menu => {
            menu.onclick = e => this.onContextMenuClick(e);
        });
    }

    // ===== Mouse Events =====
    
    onMouseDown(e) {
        this.interaction.didMove = false;
        const target = e.target;
        const coords = this.getCanvasCoords(e.clientX, e.clientY);

        if (target.classList.contains('node-header') || 
            target.classList.contains('node-content') || 
            target.classList.contains('node-text')) {
            this.startDrag(e);
        } else if (target.classList.contains('resize-handle')) {
            this.startResize(e);
        } else if (target.classList.contains('connection-point')) {
            this.startConnection(e);
        } else if (target === this.dom.canvas || target === this.dom.canvasContent) {
            if (e.button === 0) {
                this.startSelection(e, coords);
            } else if (e.button === 2) {
                this.startPan(e);
            }
        }
    }

    onMouseMove(e) {
        const mode = this.interaction.mode;
        if (!mode) return;

        this.interaction.didMove = true;
        const coords = this.getCanvasCoords(e.clientX, e.clientY);
        const data = this.interaction.data;

        switch (mode) {
            case 'drag':
                this.updateDrag(coords);
                break;
            case 'resize':
                this.updateResize(e);
                break;
            case 'pan':
                this.updatePan(e);
                break;
            case 'select':
                this.updateSelection(coords);
                break;
            case 'connect':
                this.updateConnection(coords);
                break;
        }
    }

    onMouseUp(e) {
        const mode = this.interaction.mode;
        if (!mode) return;

        // Store pan start position for context menu check
        const wasPanning = mode === 'pan';
        const panStart = wasPanning ? this.interaction.data.panStart : null;

        switch (mode) {
            case 'pan':
                this.dom.canvas.classList.remove('panning');
                break;
            case 'select':
                this.finishSelection();
                break;
            case 'connect':
                this.finishConnection(e);
                break;
        }

        this.interaction.mode = null;
        this.interaction.data = wasPanning ? { panStart } : {};
        
        // Clear pan start data after a brief delay
        if (wasPanning) {
            setTimeout(() => {
                if (!this.interaction.mode) {
                    this.interaction.data = {};
                }
            }, 100);
        }
    }

    onClick(e) {
        if (this.interaction.didMove) return;

        // Hide menus
        if (!this.dom.contextMenu.contains(e.target)) this.dom.contextMenu.style.display = 'none';
        if (!this.dom.connectionContextMenu.contains(e.target)) this.dom.connectionContextMenu.style.display = 'none';

        // Handle clicks
        const target = e.target;
        
        if (target === this.dom.canvas || target === this.dom.canvasContent) {
            this.clearSelection();
            return;
        }

        const node = target.closest('.node');
        if (node && !target.classList.contains('node-text')) {
            const nodeId = node.dataset.nodeId;
            if (e.detail === 2) {
                this.enterNode(nodeId);
            } else {
                this.selectNode(nodeId, e.ctrlKey || e.shiftKey);
            }
            return;
        }

        const path = target.closest('path[data-connection-id]');
        if (path) {
            this.showConnectionMenu(path.dataset.connectionId, e);
        }
    }

    onWheel(e) {
        e.preventDefault();
        const graph = this.currentGraph;
        const rect = this.dom.canvas.getBoundingClientRect();
        const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        const oldZoom = graph.zoom;
        const delta = e.deltaY < 0 ? CONFIG.ZOOM_SENSITIVITY : -CONFIG.ZOOM_SENSITIVITY;
        graph.zoom = Math.max(CONFIG.MIN_ZOOM, Math.min(CONFIG.MAX_ZOOM, oldZoom + delta));

        const scale = graph.zoom / oldZoom;
        graph.pan.x = mouse.x - (mouse.x - graph.pan.x) * scale;
        graph.pan.y = mouse.y - (mouse.y - graph.pan.y) * scale;

        this.renderCanvas();
    }

    onContextMenu(e) {
        e.preventDefault();
        
        // Don't show context menu if we're panning or if mouse moved during right drag
        if (this.interaction.mode === 'pan') return;
        
        // Check if this is from a right-drag release (pan end)
        if (this.interaction.data.panStart) {
            const dx = Math.abs(e.clientX - this.interaction.data.panStart.x);
            const dy = Math.abs(e.clientY - this.interaction.data.panStart.y);
            if (dx > 4 || dy > 4) return;
        }

        const menu = this.dom.contextMenu;
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.display = 'block';

        this.state.contextMenuPos = this.getCanvasCoords(e.clientX, e.clientY);

        const atRoot = this.state.navigationStack.length === 1;
        menu.querySelector('[data-action="add-graph-input"]').classList.toggle('disabled', atRoot);
        menu.querySelector('[data-action="add-graph-output"]').classList.toggle('disabled', atRoot);
    }

    onContextMenuClick(e) {
        const action = e.target.dataset.action;
        if (!action || e.target.classList.contains('disabled')) return;

        switch (action) {
            case 'add-node':
                this.addNode('default', this.state.contextMenuPos);
                break;
            case 'add-graph-input':
                this.addNode('graph-input', this.state.contextMenuPos);
                break;
            case 'add-graph-output':
                this.addNode('graph-output', this.state.contextMenuPos);
                break;
            case 'delete-connection':
                this.deleteConnection(this.state.selectedConnectionId);
                break;
        }

        this.dom.contextMenu.style.display = 'none';
        this.dom.connectionContextMenu.style.display = 'none';
    }

    onKeyDown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const ctrl = e.ctrlKey || e.metaKey;
        
        if (ctrl) {
            switch (e.key.toLowerCase()) {
                case 'c': e.preventDefault(); this.copySelected(); break;
                case 'v': e.preventDefault(); this.pasteNodes(); break;
                case 'a': 
                    e.preventDefault();
                    this.currentGraph.nodes.forEach(n => this.state.selectedNodeIds.add(n.id));
                    this.render();
                    break;
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            this.deleteSelected();
        } else if (e.key === 'Escape') {
            this.clearSelection();
        }
    }

    // ===== Interaction Handlers =====
    
    startDrag(e) {
        if (e.target.classList.contains('node-text')) return;
        
        e.stopPropagation();
        const nodeId = e.target.closest('.node').dataset.nodeId;
        const coords = this.getCanvasCoords(e.clientX, e.clientY);

        // Update selection if needed
        if (!this.state.selectedNodeIds.has(nodeId)) {
            if (!e.ctrlKey && !e.shiftKey) this.state.selectedNodeIds.clear();
            this.state.selectedNodeIds.add(nodeId);
            this.render();
        }

        // Prepare drag data
        const dragNodes = [];
        this.state.selectedNodeIds.forEach(id => {
            const node = this.findNode(id);
            if (node) {
                dragNodes.push({
                    id,
                    offsetX: coords.x - node.x,
                    offsetY: coords.y - node.y
                });
            }
        });

        this.interaction.mode = 'drag';
        this.interaction.data = { nodes: dragNodes };
    }

    updateDrag(coords) {
        this.interaction.data.nodes.forEach(({ id, offsetX, offsetY }) => {
            const node = this.findNode(id);
            if (!node) return;

            node.x = this.snap(coords.x - offsetX);
            node.y = this.snap(coords.y - offsetY);

            const el = this.dom.canvasContent.querySelector(`[data-node-id="${id}"]`);
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
        });
        this.updateConnectionPaths();
    }

    startResize(e) {
        e.stopPropagation();
        const nodeId = e.target.dataset.nodeId;
        const node = this.findNode(nodeId);

        this.interaction.mode = 'resize';
        this.interaction.data = {
            nodeId,
            startWidth: node.width,
            startHeight: node.height,
            startX: e.clientX,
            startY: e.clientY
        };
    }

    updateResize(e) {
        const data = this.interaction.data;
        const node = this.findNode(data.nodeId);
        const graph = this.currentGraph;

        const dx = (e.clientX - data.startX) / graph.zoom;
        const dy = (e.clientY - data.startY) / graph.zoom;

        node.width = this.snap(Math.max(CONFIG.NODE_MIN_WIDTH, data.startWidth + dx));
        node.height = this.snap(Math.max(CONFIG.NODE_MIN_HEIGHT, data.startHeight + dy));

        const el = this.dom.canvasContent.querySelector(`[data-node-id="${data.nodeId}"]`);
        el.style.width = `${node.width}px`;
        el.style.height = `${node.height}px`;
        
        this.updateConnectionPaths();
    }

    startPan(e) {
        e.preventDefault();
        this.dom.canvas.classList.add('panning');
        
        this.interaction.mode = 'pan';
        this.interaction.data = {
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            panStart: { x: e.clientX, y: e.clientY } // Store initial position for context menu check
        };
    }

    updatePan(e) {
        const data = this.interaction.data;
        const graph = this.currentGraph;
        
        graph.pan.x += e.clientX - data.lastX;
        graph.pan.y += e.clientY - data.lastY;
        
        data.lastX = e.clientX;
        data.lastY = e.clientY;
        
        this.renderCanvas();
    }

    startSelection(e, coords) {
        if (!e.ctrlKey && !e.shiftKey) this.clearSelection();
        
        this.interaction.mode = 'select';
        this.interaction.data = { start: coords };
        
        const box = this.dom.selectionBox;
        box.style.left = `${coords.x}px`;
        box.style.top = `${coords.y}px`;
        box.style.width = '0px';
        box.style.height = '0px';
        box.style.display = 'block';
    }

    updateSelection(coords) {
        const start = this.interaction.data.start;
        const box = this.dom.selectionBox;
        
        box.style.left = `${Math.min(start.x, coords.x)}px`;
        box.style.top = `${Math.min(start.y, coords.y)}px`;
        box.style.width = `${Math.abs(coords.x - start.x)}px`;
        box.style.height = `${Math.abs(coords.y - start.y)}px`;
    }

    finishSelection() {
        const box = this.dom.selectionBox;
        box.style.display = 'none';
        
        const rect = {
            left: parseInt(box.style.left),
            top: parseInt(box.style.top),
            right: parseInt(box.style.left) + parseInt(box.style.width),
            bottom: parseInt(box.style.top) + parseInt(box.style.height)
        };
        
        this.currentGraph.nodes.forEach(node => {
            if (rect.right > node.x && rect.left < node.x + node.width &&
                rect.bottom > node.y && rect.top < node.y + node.height) {
                this.state.selectedNodeIds.add(node.id);
            }
        });
        
        this.render();
    }

    startConnection(e) {
        e.stopPropagation();
        const point = e.target;
        
        this.interaction.mode = 'connect';
        this.interaction.data = {
            nodeId: point.dataset.nodeId,
            type: point.dataset.type,
            index: parseInt(point.dataset.index)
        };
        
        const line = document.createElement('div');
        line.className = 'connection-line active';
        line.innerHTML = '<svg><path style="stroke:#4a9eff; stroke-width:4; fill:none;"></path></svg>';
        this.dom.canvasContent.appendChild(line);
    }

    updateConnection(coords) {
        const line = this.dom.canvasContent.querySelector('.connection-line.active');
        if (!line) return;
        
        const data = this.interaction.data;
        const node = this.findNode(data.nodeId);
        const nodeEl = this.dom.canvasContent.querySelector(`[data-node-id="${data.nodeId}"]`);
        
        const x1 = node.x + (data.type === 'output' ? nodeEl.offsetWidth : 0);
        const y1 = node.y + CONFIG.CONNECTION_OFFSET + (data.index * CONFIG.CONNECTION_SPACING) + 8;
        
        const path = line.querySelector('path');
        const ctrl = Math.abs(coords.x - x1) * 0.5;
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + ctrl} ${y1} ${coords.x - ctrl} ${coords.y} ${coords.x} ${coords.y}`);
    }

    finishConnection(e) {
        const line = this.dom.canvasContent.querySelector('.connection-line.active');
        if (line) line.remove();
        
        const target = e.target;
        if (!target.classList.contains('connection-point')) return;
        
        const start = this.interaction.data;
        const end = {
            nodeId: target.dataset.nodeId,
            type: target.dataset.type,
            index: parseInt(target.dataset.index)
        };
        
        // Validate connection
        if (start.nodeId === end.nodeId || start.type === end.type) return;
        
        const output = start.type === 'output' ? start : end;
        const input = start.type === 'input' ? start : end;
        
        // Check for duplicates
        const exists = this.currentGraph.connections.some(c =>
            c.start.nodeId === output.nodeId && c.start.index === output.index &&
            c.end.nodeId === input.nodeId && c.end.index === input.index
        );
        
        if (!exists) {
            this.currentGraph.connections.push({
                id: `conn_${Date.now()}`,
                start: { nodeId: output.nodeId, index: output.index },
                end: { nodeId: input.nodeId, index: input.index }
            });
            this.render();
        }
    }

    // ===== Node Operations =====
    
    addNode(type = 'default', position = null) {
        const graph = this.currentGraph;
        
        if (!position) {
            const center = this.getCanvasCoords(
                this.dom.canvas.clientWidth / 2,
                this.dom.canvas.clientHeight / 2
            );
            position = center;
        }
        
        const nodeId = `node_${this.state.nodeCounter++}`;
        const node = {
            id: nodeId,
            x: this.snap(position.x),
            y: this.snap(position.y),
            width: CONFIG.NODE_MIN_WIDTH,
            height: CONFIG.NODE_MIN_HEIGHT,
            color: 'default',
            type: type,
            text: '',
            title: '',
            inputs: [],
            outputs: [],
            subgraphId: null
        };
        
        // Configure node by type
        switch (type) {
            case 'default':
                node.title = `Node ${this.state.nodeCounter - 1}`;
                const subgraphId = `graph_${nodeId}`;
                node.subgraphId = subgraphId;
                this.state.graphs[subgraphId] = {
                    id: subgraphId,
                    name: node.title,
                    nodes: [],
                    connections: [],
                    pan: { x: 0, y: 0 },
                    zoom: 1
                };
                break;
            case 'graph-input':
                node.title = 'Input';
                node.color = 'cyan';
                node.outputs = [{ name: 'Value', color: COLORS.cyan }];
                break;
            case 'graph-output':
                node.title = 'Output';
                node.color = 'orange';
                node.inputs = [{ name: 'Value', color: COLORS.orange }];
                break;
        }
        
        graph.nodes.push(node);
        
        if (type !== 'default') {
            this.updateParentInterface();
        }
        
        this.render();
    }

    deleteSelected() {
        if (this.state.selectedNodeIds.size === 0) return;
        
        const graph = this.currentGraph;
        let ioDeleted = false;
        
        // Remove nodes
        graph.nodes = graph.nodes.filter(node => {
            if (this.state.selectedNodeIds.has(node.id)) {
                if (node.type !== 'default') ioDeleted = true;
                if (node.subgraphId) delete this.state.graphs[node.subgraphId];
                return false;
            }
            return true;
        });
        
        // Remove connections
        graph.connections = graph.connections.filter(conn =>
            !this.state.selectedNodeIds.has(conn.start.nodeId) &&
            !this.state.selectedNodeIds.has(conn.end.nodeId)
        );
        
        this.state.selectedNodeIds.clear();
        
        if (ioDeleted) this.updateParentInterface();
        
        this.render();
    }

    deleteConnection(connectionId) {
        if (!connectionId) return;
        
        const graph = this.currentGraph;
        graph.connections = graph.connections.filter(c => c.id !== connectionId);
        this.state.selectedConnectionId = null;
        this.render();
    }

    copySelected() {
        if (this.state.selectedNodeIds.size === 0) return;
        
        this.state.copiedNodes = this.currentGraph.nodes
            .filter(n => this.state.selectedNodeIds.has(n.id))
            .map(n => JSON.parse(JSON.stringify(n)));
        
        this.renderToolbar();
    }

    pasteNodes() {
        if (this.state.copiedNodes.length === 0) return;
        
        const graph = this.currentGraph;
        this.clearSelection();
        
        this.state.copiedNodes.forEach(nodeData => {
            const node = JSON.parse(JSON.stringify(nodeData));
            node.id = `node_${this.state.nodeCounter++}`;
            node.x += CONFIG.GRID_SIZE;
            node.y += CONFIG.GRID_SIZE;
            
            // Copy subgraph if exists
            if (node.subgraphId) {
                const oldSubgraph = this.state.graphs[node.subgraphId];
                if (oldSubgraph) {
                    const newSubgraphId = `graph_${node.id}`;
                    this.state.graphs[newSubgraphId] = JSON.parse(JSON.stringify(oldSubgraph));
                    this.state.graphs[newSubgraphId].id = newSubgraphId;
                    this.state.graphs[newSubgraphId].name = node.title;
                    node.subgraphId = newSubgraphId;
                }
            }
            
            graph.nodes.push(node);
            this.state.selectedNodeIds.add(node.id);
        });
        
        this.render();
    }

    selectNode(nodeId, multi = false) {
        if (!multi && !this.state.selectedNodeIds.has(nodeId)) {
            this.state.selectedNodeIds.clear();
        }
        
        if (this.state.selectedNodeIds.has(nodeId) && multi) {
            this.state.selectedNodeIds.delete(nodeId);
        } else {
            this.state.selectedNodeIds.add(nodeId);
        }
        
        this.render();
    }

    clearSelection() {
        if (this.state.selectedNodeIds.size > 0) {
            this.state.selectedNodeIds.clear();
            this.render();
        }
    }

    updateNodeProp(nodeId, prop, value, source = null) {
        const node = this.findNode(nodeId);
        if (!node) return;
        
        node[prop] = value;
        
        // Update UI elements
        if (prop === 'title') {
            const header = this.dom.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-header`);
            if (header && header !== source) header.textContent = value;
            
            const titleInput = document.getElementById('propNodeTitle');
            if (titleInput && titleInput !== source) titleInput.value = value;
            
            // Update subgraph name
            if (node.subgraphId) {
                const subgraph = this.state.graphs[node.subgraphId];
                if (subgraph) {
                    subgraph.name = value;
                    if (this.state.navigationStack.includes(node.subgraphId)) {
                        this.renderToolbar();
                    }
                }
            }
            
            // Update parent if I/O node
            if (node.type !== 'default') {
                this.updateParentInterface();
            }
        } else if (prop === 'text') {
            const textarea = this.dom.canvasContent.querySelector(`[data-node-id="${nodeId}"] .node-text`);
            if (textarea && textarea !== source) textarea.value = value;
            
            const contentInput = document.getElementById('propNodeContent');
            if (contentInput && contentInput !== source) contentInput.value = value;
        }
    }

    setNodeColor(nodeId, color) {
        const node = this.findNode(nodeId);
        if (!node) return;
        
        node.color = color;
        const pinColor = COLORS[color] || COLORS.default;
        
        // Update pin colors for I/O nodes
        if (node.type === 'graph-input' && node.outputs[0]) {
            node.outputs[0].color = pinColor;
        } else if (node.type === 'graph-output' && node.inputs[0]) {
            node.inputs[0].color = pinColor;
        }
        
        if (node.type !== 'default') {
            this.updateParentInterface();
        }
        
        this.render();
    }

    // ===== Navigation =====
    
    enterNode(nodeId) {
        const node = this.findNode(nodeId);
        if (node?.subgraphId) {
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

    updateParentInterface() {
        if (this.state.navigationStack.length <= 1) return;
        
        const currentId = this.state.navigationStack.at(-1);
        const parentId = this.state.navigationStack.at(-2);
        const parentGraph = this.state.graphs[parentId];
        
        const parentNode = parentGraph.nodes.find(n => n.subgraphId === currentId);
        if (!parentNode) return;
        
        const currentGraph = this.state.graphs[currentId];
        const inputs = currentGraph.nodes.filter(n => n.type === 'graph-input');
        const outputs = currentGraph.nodes.filter(n => n.type === 'graph-output');
        
        parentNode.inputs = inputs.map(n => ({
            name: n.title,
            color: COLORS[n.color] || COLORS.default
        }));
        
        parentNode.outputs = outputs.map(n => ({
            name: n.title,
            color: COLORS[n.color] || COLORS.default
        }));
    }

    showConnectionMenu(connectionId, e) {
        this.state.selectedConnectionId = connectionId;
        const menu = this.dom.connectionContextMenu;
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.display = 'block';
    }

    // ===== Rendering =====
    
    render() {
        this.renderCanvas();
        this.renderToolbar();
        this.renderProperties();
    }

    renderCanvas() {
        const graph = this.currentGraph;
        const content = this.dom.canvasContent;
        
        // Save textarea scroll positions
        const scrolls = {};
        content.querySelectorAll('.node-text').forEach(ta => {
            const nodeId = ta.closest('.node').dataset.nodeId;
            scrolls[nodeId] = { top: ta.scrollTop, left: ta.scrollLeft };
        });
        
        // Clear and recreate
        content.innerHTML = '<div class="selection-box" id="selectionBox"></div>';
        this.dom.selectionBox = document.getElementById('selectionBox');
        
        // Apply transform
        const transform = `translate(${graph.pan.x}px, ${graph.pan.y}px) scale(${graph.zoom})`;
        content.style.transform = transform;
        
        // Update grid
        const gridSize = CONFIG.GRID_SIZE * graph.zoom;
        this.dom.canvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
        this.dom.canvas.style.backgroundPosition = `${graph.pan.x % gridSize}px ${graph.pan.y % gridSize}px`;
        
        // Render nodes and connections
        graph.nodes.forEach(node => this.renderNode(node));
        graph.connections.forEach(conn => this.renderConnection(conn));
        
        // Restore scroll positions
        Object.entries(scrolls).forEach(([nodeId, scroll]) => {
            const ta = content.querySelector(`[data-node-id="${nodeId}"] .node-text`);
            if (ta) {
                ta.scrollTop = scroll.top;
                ta.scrollLeft = scroll.left;
            }
        });
    }

    renderNode(node) {
        const el = document.createElement('div');
        const isSelected = this.state.selectedNodeIds.has(node.id);
        const hasSubgraph = node.subgraphId && this.state.graphs[node.subgraphId]?.nodes.length > 0;
        
        el.className = `node color-${node.color} ${isSelected ? 'selected' : ''} ${hasSubgraph ? 'has-subgraph' : ''}`;
        el.dataset.nodeId = node.id;
        el.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px`;
        
        const textContent = node.type === 'default' 
            ? `<textarea class="node-text" placeholder="Enter text...">${node.text}</textarea>`
            : '';
        
        el.innerHTML = `
            <div class="node-header">${node.title}</div>
            <div class="node-content">${textContent}</div>
            ${node.type === 'default' ? `<div class="resize-handle" data-node-id="${node.id}"></div>` : ''}
        `;
        
        this.dom.canvasContent.appendChild(el);
        this.renderConnectionPoints(el, node);
    }

    renderConnectionPoints(nodeEl, node) {
        const createPoint = (data, type, index) => {
            const y = CONFIG.CONNECTION_OFFSET + (index * CONFIG.CONNECTION_SPACING);
            
            const point = document.createElement('div');
            point.className = `connection-point ${type}`;
            point.dataset.nodeId = node.id;
            point.dataset.type = type;
            point.dataset.index = index;
            point.style.top = `${y}px`;
            point.style.backgroundColor = data.color;
            
            const label = document.createElement('div');
            label.className = 'connection-point-label';
            label.textContent = data.name;
            label.style.top = `${y}px`;
            
            nodeEl.appendChild(point);
            nodeEl.appendChild(label);
        };
        
        node.inputs.forEach((input, i) => createPoint(input, 'input', i));
        node.outputs.forEach((output, i) => createPoint(output, 'output', i));
        
        // Set minimum content height
        const maxPoints = Math.max(node.inputs.length, node.outputs.length);
        const minHeight = maxPoints > 0 ? (maxPoints * CONFIG.CONNECTION_SPACING + 16) : 0;
        nodeEl.querySelector('.node-content').style.minHeight = `${minHeight}px`;
    }

    renderConnection(conn) {
        const startNode = this.findNode(conn.start.nodeId);
        const endNode = this.findNode(conn.end.nodeId);
        if (!startNode || !endNode) return;
        
        const line = document.createElement('div');
        line.className = 'connection-line';
        line.dataset.connectionId = conn.id;
        
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, 'svg');
        const defs = document.createElementNS(svgNS, 'defs');
        const gradient = document.createElementNS(svgNS, 'linearGradient');
        const path = document.createElementNS(svgNS, 'path');
        
        const gradId = `grad_${conn.id}`;
        gradient.setAttribute('id', gradId);
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        
        const startColor = startNode.outputs[conn.start.index]?.color || COLORS.default;
        const endColor = endNode.inputs[conn.end.index]?.color || COLORS.default;
        
        gradient.innerHTML = `
            <stop offset="0%" style="stop-color:${startColor}" />
            <stop offset="100%" style="stop-color:${endColor}" />
        `;
        
        path.setAttribute('stroke', `url(#${gradId})`);
        path.dataset.connectionId = conn.id;
        
        defs.appendChild(gradient);
        svg.appendChild(defs);
        svg.appendChild(path);
        line.appendChild(svg);
        this.dom.canvasContent.appendChild(line);
        
        this.updateConnectionPath(conn.id);
    }

    updateConnectionPath(connectionId) {
        const conn = this.currentGraph.connections.find(c => c.id === connectionId);
        if (!conn) return;
        
        const line = this.dom.canvasContent.querySelector(`.connection-line[data-connection-id="${connectionId}"]`);
        if (!line) return;
        
        const startNode = this.findNode(conn.start.nodeId);
        const endNode = this.findNode(conn.end.nodeId);
        if (!startNode || !endNode) {
            line.remove();
            return;
        }
        
        const startEl = this.dom.canvasContent.querySelector(`[data-node-id="${conn.start.nodeId}"]`);
        if (!startEl) return;
        
        const x1 = startNode.x + startEl.offsetWidth;
        const y1 = startNode.y + CONFIG.CONNECTION_OFFSET + (conn.start.index * CONFIG.CONNECTION_SPACING) + 8;
        const x2 = endNode.x;
        const y2 = endNode.y + CONFIG.CONNECTION_OFFSET + (conn.end.index * CONFIG.CONNECTION_SPACING) + 8;
        
        const path = line.querySelector('path');
        const ctrl = Math.abs(x2 - x1) * 0.5;
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + ctrl} ${y1} ${x2 - ctrl} ${y2} ${x2} ${y2}`);
        
        const gradient = line.querySelector('linearGradient');
        if (gradient) {
            gradient.setAttribute('x1', x1);
            gradient.setAttribute('y1', y1);
            gradient.setAttribute('x2', x2);
            gradient.setAttribute('y2', y2);
        }
    }

    updateConnectionPaths() {
        this.currentGraph.connections.forEach(conn => this.updateConnectionPath(conn.id));
    }

    renderToolbar() {
        // Update buttons
        this.dom.copyBtn.disabled = this.state.selectedNodeIds.size === 0;
        this.dom.pasteBtn.disabled = this.state.copiedNodes.length === 0;
        this.dom.deleteBtn.disabled = this.state.selectedNodeIds.size === 0;
        
        // Update selection count
        const count = this.state.selectedNodeIds.size;
        this.dom.selectedCount.textContent = count > 0 ? `${count} node${count > 1 ? 's' : ''} selected` : '';
        
        // Update breadcrumbs
        this.dom.breadcrumbs.innerHTML = '';
        
        this.state.navigationStack.forEach((graphId, index) => {
            const graph = this.state.graphs[graphId];
            if (!graph) return;
            
            const isLast = index === this.state.navigationStack.length - 1;
            
            if (graphId === 'root' && isLast) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'breadcrumb-input';
                input.value = graph.name;
                input.oninput = e => {
                    this.state.graphs.root.name = e.target.value;
                };
                input.onchange = e => {
                    if (this.state.graphs.root.name.trim() === '') {
                        this.state.graphs.root.name = 'Root';
                        e.target.value = 'Root';
                    }
                };
                this.dom.breadcrumbs.appendChild(input);
            } else {
                const item = document.createElement('span');
                item.textContent = graph.name;
                item.className = `breadcrumb-item ${isLast ? 'active' : ''}`;
                if (!isLast) item.onclick = () => this.navigateToLevel(index);
                this.dom.breadcrumbs.appendChild(item);
            }
            
            if (!isLast) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = '>';
                this.dom.breadcrumbs.appendChild(sep);
            }
        });
    }

    renderProperties() {
        const panel = this.dom.propertiesPanel;
        const content = this.dom.propertiesContent;
        const selected = this.state.selectedNodeIds;
        
        if (selected.size === 0) {
            panel.classList.remove('show');
            return;
        }
        
        panel.classList.add('show');
        
        if (selected.size > 1) {
            content.innerHTML = `<p>${selected.size} nodes selected</p>`;
            return;
        }
        
        const nodeId = selected.values().next().value;
        const node = this.findNode(nodeId);
        if (!node) return;
        
        const isIO = node.type === 'graph-input' || node.type === 'graph-output';
        
        content.innerHTML = `
            <div class="property-group">
                <label>Node Title:</label>
                <input type="text" id="propNodeTitle" value="${node.title}" data-node-id="${nodeId}">
            </div>
            ${!isIO ? `
                <div class="property-group">
                    <label>Text Content:</label>
                    <textarea id="propNodeContent" rows="4" data-node-id="${nodeId}">${node.text}</textarea>
                </div>
            ` : ''}
            <div class="property-group">
                <label>Node Color:</label>
                <div class="color-options">
                    ${Object.keys(COLORS).map(color => `
                        <div class="color-option ${color} ${node.color === color ? 'selected' : ''}" 
                             onclick="window.nodeEditor.setNodeColor('${nodeId}', '${color}')"></div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Bind property events
        const titleInput = document.getElementById('propNodeTitle');
        const contentInput = document.getElementById('propNodeContent');
        
        if (titleInput) {
            titleInput.oninput = e => this.updateNodeProp(e.target.dataset.nodeId, 'title', e.target.value, e.target);
        }
        if (contentInput) {
            contentInput.oninput = e => this.updateNodeProp(e.target.dataset.nodeId, 'text', e.target.value, e.target);
        }
    }

    // ===== Save/Load =====
    
    saveGraph() {
        const rootGraph = this.state.graphs.root;
        
        // Validate name
        if (!rootGraph.name || rootGraph.name === 'Root' || rootGraph.name.trim() === '') {
            const name = prompt("Please enter a project name before saving:", "My Project");
            if (!name || name.trim() === '') {
                alert("Save cancelled. A valid project name is required.");
                return;
            }
            rootGraph.name = name.trim();
            this.renderToolbar();
        }
        
        const fileName = `${rootGraph.name.replace(/[^a-z0-9_ -]/gi, '_').trim()}.json`;
        const data = {
            version: "1.0.0",
            graphs: this.state.graphs
        };
        
        this.downloadJSON(data, fileName);
    }

    saveSimpleGraph() {
        const rootGraph = this.state.graphs.root;
        
        // Validate name
        if (!rootGraph.name || rootGraph.name === 'Root' || rootGraph.name.trim() === '') {
            const name = prompt("Please enter a project name before saving:", "My Project");
            if (!name || name.trim() === '') {
                alert("Save cancelled. A valid project name is required.");
                return;
            }
            rootGraph.name = name.trim();
            this.renderToolbar();
        }
        
        const fileName = `${rootGraph.name.replace(/[^a-z0-9_ -]/gi, '_').trim()}_readable.json`;
        
        // Generate unique handles for all nodes
        const nodeToHandle = new Map();
        const usedHandles = new Set();
        
        Object.values(this.state.graphs).forEach(graph => {
            graph.nodes.forEach(node => {
                const handle = this.generateHandle(node.title || node.type, usedHandles);
                usedHandles.add(handle);
                nodeToHandle.set(node.id, handle);
            });
        });
        
        const data = {
            format: "node-graph-v4-logic-only",
            title: rootGraph.name,
            graph: this.convertToReadable(rootGraph.id, nodeToHandle)
        };
        
        this.downloadJSON(data, fileName);
    }

    convertToReadable(graphId, nodeToHandle) {
        const graph = this.state.graphs[graphId];
        if (!graph) return null;
        
        const readable = {
            nodes: [],
            connections: []
        };
        
        // Convert nodes
        readable.nodes = graph.nodes.map(node => {
            const readableNode = {
                id: nodeToHandle.get(node.id),
                title: node.title,
                text: node.text,
                color: node.color,
                type: node.type,
                inputs: node.inputs,
                outputs: node.outputs
            };
            
            if (node.subgraphId) {
                readableNode.subgraph = this.convertToReadable(node.subgraphId, nodeToHandle);
            }
            
            return readableNode;
        });
        
        // Convert connections with pin disambiguation
        readable.connections = graph.connections.map(conn => {
            const startNode = this.findNode(conn.start.nodeId, graphId);
            const endNode = this.findNode(conn.end.nodeId, graphId);
            if (!startNode || !endNode) return null;
            
            const startPin = startNode.outputs[conn.start.index]?.name || `output_${conn.start.index}`;
            const isStartAmbiguous = startNode.outputs.filter(p => p.name === startPin).length > 1;
            const startRef = isStartAmbiguous ? `${startPin}:${conn.start.index}` : startPin;
            
            const endPin = endNode.inputs[conn.end.index]?.name || `input_${conn.end.index}`;
            const isEndAmbiguous = endNode.inputs.filter(p => p.name === endPin).length > 1;
            const endRef = isEndAmbiguous ? `${endPin}:${conn.end.index}` : endPin;
            
            return {
                from: `${nodeToHandle.get(conn.start.nodeId)}.outputs.${startRef}`,
                to: `${nodeToHandle.get(conn.end.nodeId)}.inputs.${endRef}`
            };
        }).filter(Boolean);
        
        return readable;
    }

    loadGraph(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (!data) throw new Error("File is empty or invalid.");
                
                // Detect format and load accordingly
                if (data.format?.startsWith("node-graph-v") && data.graph) {
                    this.loadReadableGraph(data);
                } else if (data.graphs && data.version) {
                    this.loadFullGraph(data);
                } else {
                    throw new Error("Invalid or unsupported file format.");
                }
            } catch (error) {
                alert('Error loading graph: ' + error.message);
                console.error(error);
            }
        };
        
        reader.readAsText(file);
        event.target.value = '';
    }

    loadFullGraph(data) {
        this.resetState();
        this.state.graphs = data.graphs;
        
        // Update node counter
        let maxId = 0;
        Object.values(this.state.graphs).forEach(graph => {
            graph.nodes.forEach(node => {
                const id = parseInt(node.id.split('_')[1], 10);
                if (!isNaN(id) && id > maxId) maxId = id;
            });
        });
        this.state.nodeCounter = maxId + 1;
        
        this.render();
    }

    loadReadableGraph(data) {
        this.resetState();
        const handleToId = new Map();
        
        // Convert readable format back to internal format
        const rootReadable = data.graph;
        rootReadable.id = 'root';
        rootReadable.name = data.title || 'Loaded Graph';
        
        this.convertFromReadable(rootReadable, handleToId);
        
        // Apply procedural layout to all graphs
        Object.values(this.state.graphs).forEach(graph => {
            this.layoutGraph(graph);
        });
        
        this.state.graphs.root.name = data.title || 'Loaded Graph';
        this.render();
    }

    convertFromReadable(readable, handleToId) {
        const graph = {
            id: readable.id,
            name: readable.name,
            pan: { x: 50, y: 50 },
            zoom: 1,
            nodes: [],
            connections: []
        };
        
        // Convert nodes
        readable.nodes.forEach(readableNode => {
            const nodeId = `node_${this.state.nodeCounter++}`;
            handleToId.set(readableNode.id, nodeId);
            
            const node = {
                ...readableNode,
                id: nodeId,
                x: 0,
                y: 0,
                width: CONFIG.NODE_MIN_WIDTH,
                height: CONFIG.NODE_MIN_HEIGHT
            };
            
            // Handle subgraph
            if (readableNode.subgraph) {
                const subgraph = readableNode.subgraph;
                subgraph.id = `graph_${nodeId}`;
                subgraph.name = readableNode.title;
                node.subgraphId = subgraph.id;
                this.convertFromReadable(subgraph, handleToId);
                delete node.subgraph;
            } else if (node.type === 'default') {
                // Create empty subgraph for default nodes
                const subgraphId = `graph_${nodeId}`;
                this.state.graphs[subgraphId] = {
                    id: subgraphId,
                    name: node.title,
                    nodes: [],
                    connections: [],
                    pan: { x: 0, y: 0 },
                    zoom: 1
                };
                node.subgraphId = subgraphId;
            }
            
            graph.nodes.push(node);
        });
        
        // Convert connections with pin disambiguation
        if (readable.connections) {
            readable.connections.forEach(conn => {
                const fromParts = conn.from.split('.');
                const toParts = conn.to.split('.');
                
                const startHandle = fromParts[0];
                const endHandle = toParts[0];
                
                // Parse pin references with disambiguation
                let startPin = fromParts.slice(2).join('.');
                let startIndex = -1;
                if (startPin.includes(':')) {
                    const [name, idx] = startPin.split(':');
                    startPin = name;
                    startIndex = parseInt(idx, 10);
                }
                
                let endPin = toParts.slice(2).join('.');
                let endIndex = -1;
                if (endPin.includes(':')) {
                    const [name, idx] = endPin.split(':');
                    endPin = name;
                    endIndex = parseInt(idx, 10);
                }
                
                const startId = handleToId.get(startHandle);
                const endId = handleToId.get(endHandle);
                const startNode = graph.nodes.find(n => n.id === startId);
                const endNode = graph.nodes.find(n => n.id === endId);
                
                if (startNode && endNode) {
                    if (startIndex === -1) {
                        startIndex = startNode.outputs.findIndex(o => o.name === startPin);
                    }
                    if (endIndex === -1) {
                        endIndex = endNode.inputs.findIndex(i => i.name === endPin);
                    }
                    
                    if (startIndex !== -1 && endIndex !== -1) {
                        graph.connections.push({
                            id: `conn_${Date.now()}_${Math.random()}`,
                            start: { nodeId: startId, index: startIndex },
                            end: { nodeId: endId, index: endIndex }
                        });
                    }
                }
            });
        }
        
        this.state.graphs[graph.id] = graph;
    }

    layoutGraph(graph) {
        if (!graph || graph.nodes.length === 0) return;
        
        // Create layers based on connectivity
        const layers = new Map();
        const layerCounts = new Map();
        
        // Find root nodes (no incoming connections)
        const rootNodes = [];
        graph.nodes.forEach(node => {
            const hasIncoming = graph.connections.some(c => c.end.nodeId === node.id);
            if (!hasIncoming) {
                layers.set(node.id, 0);
                rootNodes.push(node);
            }
        });
        
        // BFS to assign layers
        const queue = [...rootNodes];
        while (queue.length > 0) {
            const current = queue.shift();
            const currentLayer = layers.get(current.id);
            
            graph.connections
                .filter(c => c.start.nodeId === current.id)
                .forEach(conn => {
                    const targetId = conn.end.nodeId;
                    if (!layers.has(targetId)) {
                        layers.set(targetId, currentLayer + 1);
                        const target = graph.nodes.find(n => n.id === targetId);
                        if (target) queue.push(target);
                    }
                });
        }
        
        // Position nodes
        graph.nodes.forEach(node => {
            const layer = layers.get(node.id) || 0;
            const index = layerCounts.get(layer) || 0;
            
            node.x = layer * CONFIG.LAYOUT_PADDING_X;
            node.y = index * CONFIG.LAYOUT_PADDING_Y;
            
            layerCounts.set(layer, index + 1);
        });
        
        graph.pan = { x: 50, y: 50 };
        graph.zoom = 1;
    }

    generateHandle(baseName, existingHandles) {
        let handle = (baseName || 'unnamed-node')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-') || 'unnamed-node';
        
        let finalHandle = handle;
        let counter = 1;
        
        while (existingHandles.has(finalHandle)) {
            counter++;
            finalHandle = `${handle}-${counter}`;
        }
        
        return finalHandle;
    }

    downloadJSON(data, fileName) {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        
        URL.revokeObjectURL(url);
    }
}

// Initialize
window.nodeEditor = new NodeEditor('canvas');