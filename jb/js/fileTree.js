(function ( $ ) {

    function isEmptyNode(node) {
        return node.hasOwnProperty('empty') && node.empty;
    }

    /**
     * Sorting function for array of tree nodes.
     * Directories are less then archives and
     * archives are less then anything else.
     */
    function sortNodes(first, second) {
        function weight(node) {
            if (node.fileData.type === 'directory') {
                return 2;
            }
            return node.fileData.expandable ? 1 : 0;
        }
        return weight(second) - weight(first);
    }

    /**
     * Implementation of file data tree which
     * uses index map (from file path to tree node)
     * for faster and easier access to tree nodes
     * by file path.
     */
    var getIndexedFileDataTree = function(root) {
        function IndexedFileDataTree() {
            this.root = root;

            // Index tree for easier access to nodes by path
            var pathToNodeIndex = {}
            function index(node) {
                if (isEmptyNode(node)) {
                    return; // No need to index that
                }
                pathToNodeIndex[node.fileData.path] = node;
                if (node.fileData.expandable)
                    node.children.forEach(function(e) {
                        index(e);
                    });
            }
            function removeFromIndex(node) {
                if (isEmptyNode) {
                    return;
                }
                delete pathToNodeIndex[node.fileData.path];
                if (node.fileData.expandable)
                    node.children.forEach(function(e) {
                        removeFromIndex(e);
                    });
            }
            index(this.root);

            // Define member functions

            /**
             * Get node by file path
             */
            this.get = function(path) {
                var node = pathToNodeIndex[path];
                if (node == null) {
                    console.error("No node was found by path: " + path);
                    return null;
                }
                return node;
            }

            /**
             * Add node to node with specific file path
             */
            this.add = function(parentPath, node) {
                var parentNode = get(parentPath);
                index(node);
                parentNode.children.push(node);
            }

            /**
             * Replace all subnodes of node with specific
             * file path
             */
            this.set = function(parentPath, nodes) {
                var node = this.get(parentPath);
                if (node.fileData.expandable)
                    node.children.forEach(removeFromIndex);
                node.children = nodes;
                nodes.forEach(index);
                return node;
            }

            /**
             * Remove all subnodes of node with specific
             * file path
             */
            this.clear = function(parentPath) {
                var node = this.get(parentPath);
                if (node.fileData.expandable)
                    node.children.forEach(removeFromIndex);
                node.children = [];
            }
        }
        return new IndexedFileDataTree();
    }

    /**
     * State holder which uses `window.localStorage` to
     * store current UI state (see `defaultConfig` for
     * details)
     */
    var getLocalStorageStateHolder = function(id) {
        function LocalStorageStateHolder() {
            var storageKey = 'ru.kozobrodov.fileTree$' + id
            // Init root node
            function initState() {
                var rootNode = {
                    fileData: {path: '', name: '', type: 'directory', expandable: true},
                    children: []
                };
                localStorage.setItem(storageKey, JSON.stringify(rootNode));
                return rootNode;
            }
            var stateString = localStorage.getItem(storageKey);
            if (stateString != null && typeof stateString != 'undefined') {
                this.tree = getIndexedFileDataTree(JSON.parse(stateString));
            } else {
                this.tree = getIndexedFileDataTree(initState());
            }

            this.saveState = function() {
                localStorage.setItem(
                    storageKey,
                    JSON.stringify(this.getCurrentState())
                );
            }

            this.addNodes = function(path, children) {
                var updatedNode = this.tree.set(path, children);
                this.saveState();
                return updatedNode;
            }

            this.clearNode = function(path) {
                this.tree.clear(path);
                this.saveState();
            }

            this.getCurrentState = function() {
                return this.tree.root;
            }
        }
        return new LocalStorageStateHolder();
    }

    /**
     * Data provider which loads the full directory
     * structures as JSON file
     */
    var getJsonDataProvider = function(jsonPath) {
        function JsonDataProvider() {
            this.load = function(callback) {
                $.ajax({
                    url: jsonPath,
                    dataType: 'json',
                    context : this,
                    success: function (data) {
                        this.tree = getIndexedFileDataTree(data);
                        callback();
                    }
                });
            }

            this.list = function(path, callback) {
                var data = this.tree.get(path).children;
                data.sort(sortNodes);
                callback(data);
            }

        }
        return new JsonDataProvider();
    }

    /**
     * Data provider which uses remote service to get
     * data about files
     */
    var getServiceDataProvider = function(url) {
        function ServiceDataProvider() {
            this.load = function(callback) {callback();}

            function mapToTreeNode(data, callback) {
                var nodes = [];
                data.forEach(function(fileData) {
                    var node = {
                        fileData: fileData,
                        children: []
                    }
                    nodes.push(node);
                });
                nodes.sort(sortNodes);
                callback(nodes);
            }

            this.list = function(path, callback, errorCallback) {
                $.get(url + path, function(data) {mapToTreeNode(data, callback)})
                    .fail(function(jqXHR) {
                        switch(jqXHR.status) {
                            case 501:
                            case 404:
                                alert(jqXHR.responseText);
                                break;
                            default:
                                console.error(jqXHR.statusText);
                                console.error(jqXHR);
                        }
                        errorCallback();
                    });
            }
        }
        return new ServiceDataProvider();
    }

    /**
     * Central part of this plugin, responsible for rendering,
     * UI behaviour and data/state orchestration
     */
    function Core(settings) {
        /**
         * Transform file name using the following rules:
         * - If file name is empty, it's a root directory
         *   and special element presenting it must be returned
         * - If name is too long (more than 40 symbols), it must
         *   be shortened using special '<...>' filler
         * - Name itself must be returned in all other cases
         */
        function extractFileName(name) {
            if (name === "") { // Extra case - root directory
                return $('<span>').addClass('meta').append('&lt;root&gt;');
            }
            if (name.length > 40) {
                return name.substring(0, 30) + '<span class="meta">&lt;...&gt;</span>';
            }
            return name;
        }

        /**
         * Returns icon class by file type or default icon class
         */
        function typeToIcon(type) {
            var clazz = settings.typeToIconClassMap[type];
            if (clazz != null) {
                return clazz;
            }
            return settings.defaultIconClass;
        }

        function getLoader() {
            return $('<div>').addClass('loader');
        }

        /**
         * Copies tree node without its children
         */
        function copyChildren(children) {
            var result = [];
            children.forEach(function(child) {
                if (isEmptyNode(child)) {
                    result.push(child); // No need to copy that
                    return;
                }
                var copy = {};
                copy.fileData = $.extend({}, child.fileData);
                if (child.fileData.expandable)
                    copy.children = [] // Don't need to copy children
                result.push(copy);
            });
            return result;
        }

        function expandableNodeClickHandler() {
            var element = $(this);
            var parent = element.parent();
            var path = element.attr('path');
            if (parent.has('ul.nested').length > 0) {
                // Collapse
                parent.children('ul.nested').remove();
                settings.stateHolder.clearNode(path);
            } else {
                // Expand
                parent.append(getLoader());
                settings.dataProvider.list(path, function(data) {
                    if (data.length == 0) {
                        var emptyNode = {empty:true};
                        data.push(emptyNode);
                    }
                    var node = settings.stateHolder.addNodes(path, copyChildren(data));
                    render(parent.empty(), node);
                }, function() {
                    // Remove loader in case of error:
                    parent.children('div').remove();
                });
            }
        }

        function renderItem(element, node) {
            var icon = $('<i>')
                    .addClass(typeToIcon(node.fileData.type))
                    .attr('title', node.fileData.type);
            var itemContent = $('<span>')
                .attr('path', node.fileData.path)
                .append(
                    icon,
                    ' ',
                    extractFileName(node.fileData.name)
                );
            if (node.fileData.expandable) {
                itemContent
                    .click(expandableNodeClickHandler)
                    .addClass('expandable');
            }
            return $('<li>').append(itemContent).appendTo(element);
        }

        function renderEmptyItem(element) {
            $('<li>')
                .append($('<span>').addClass('meta').append('&lt;empty&gt;'))
                .appendTo(element);
        }

        function render(element, tree, deepRender) {
            if (isEmptyNode(tree)) {
                renderEmptyItem(element);
                return;
            }

            var item = renderItem(element, tree);
            if (tree.fileData.expandable) {
                if (tree.children.length > 0) {
                    var nested = $('<ul>').addClass('nested');
                    item.append(nested);
                    tree.children.forEach(function(subnode) {
                        if (isEmptyNode(subnode)) {
                            renderEmptyItem(nested);
                        } else if (deepRender) {
                            render(nested, subnode, deepRender);
                        } else {
                            renderItem(nested, subnode);
                        }
                    });
                }
            }
        }

        this.init = function(element) {
            // Create view container-list
            element.empty();
            var container = $('<ul>').addClass('treeView').appendTo(element);

            // And render current state
            var tree = settings.stateHolder.getCurrentState();
            render(container, tree, true);
        }
    }

    /**
     * Default configuration of the plugin
     */
    var defaultConfig = {
        /**
         * Object which handles changes on file tree state.
         *
         * Must provide the following methods:
         * - `addNodes(parentPath, fileData)` (where `fileData`
         *   is an array of `FileData`(see below)) which is
         *   called when expandable file is opened (expanded)
         * - `clearNode(path)` which is called when expandable
         *   file is closed (collapsed)
         * - `getCurrentState()` which returns tree representing
         *   current state
         *
         * State tree must be built from nodes represented by
         * the following structure:
         *
         * ```
         * {
         *     fileData: {path: "<file_path>", type: "<file_type>", expandable: <boolean>},
         *     children: <array_of_subnodes>
         * }
         * ```
         */
        stateHolder: null,

        /**
         * Identifier of file tree. Used internally to differentiate
         * different trees, so that it's possible to use several
         * trees on single page
         */
        treeId: '',

        /**
         * Object which provides loadable data, must provide
         * only one method: `list(path)` which returns array
         * of `FileData` objects:
         *
         * ```
         * {
         *     path: "<file_path>",
         *     type: "<file_type>",
         *     expandable: <boolean>
         * }
         * ```
         */
        dataProvider: null,

        /**
         * Map of file MIME type to appropriate icons classes
         */
        typeToIconClassMap: {
            "directory": "fas fa-folder",
            "application/pdf": "fas fa-file-pdf",
            "application/x-rar": "fas fa-file-archive rar",
            "application/x-rar-compressed": "fas fa-file-archive rar",
            "application/zip": "fas fa-file-archive zip",
            "application/x-zip-compressed": "fas fa-file-archive zip",
            "application/x-java-archive": "fas fa-file-archive jar",
            "application/java-archive": "fas fa-file-archive jar",
            "<unknown_type>": "fas fa-file",
            "image/jpeg": "fas fa-file-image",
            "text/plain": "fas fa-file-alt"
        },
        defaultIconClass: "fas fa-file"
    };

    /**
     * Plugin entry point. Defines JQuery function `fileTree`
     * which can be used to initialize tree view on specific
     * DOM element. Optionally, gets configuration which can
     * override default configuration (see `defaultConfig` for
     * details).
     */
    $.fn.fileTree = function(config) {
        var settings = $.extend({}, defaultConfig, config);

        // Set state holder
        if (settings.hasOwnProperty('stateHolder') && settings.stateHolder == null) {
            settings.stateHolder = getLocalStorageStateHolder(settings.treeId);
        }

        // Set data provider
        if (settings.hasOwnProperty('dataProvider') && settings.dataProvider == null) {
            if (settings.hasOwnProperty('serviceUrl') && settings.serviceUrl != null) {
                settings.dataProvider = getServiceDataProvider(settings.serviceUrl);
            } else if (
                    settings.hasOwnProperty('jsonLocation')
                    && settings.jsonLocation != null
            ) {
               settings.dataProvider = getJsonDataProvider(settings.jsonLocation);
            } else {
                console.error('Data provider cannot be found or chosen');
            }
        }
        return this.each(function(index, e) {
            $(e).append($('<div>').addClass('loader-big'))
            settings.dataProvider.load(function() {
                new Core(settings).init($(e));
            });
        });
    }
}( jQuery ));