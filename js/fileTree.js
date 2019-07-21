(function ( $ ) {

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
                pathToNodeIndex[node.fileData.path] = node;
                if (node.fileData.expandable)
                    node.children.forEach(function(e) {
                        index(e);
                    });
            }
            function removeFromIndex(node) {
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
    var getLocalStorageStateHolder = function() {
        function LocalStorageStateHolder() {
            // Init root node
            function initState() {
                var rootNode = {
                    fileData: {path: '', type: 'directory', expandable: true},
                    children: []
                };
                localStorage.setItem('ru.kozobrodov.fileTree', JSON.stringify(rootNode));
                return rootNode;
            }
            var stateString = localStorage.getItem('ru.kozobrodov.fileTree');
            if (stateString != null && typeof stateString != 'undefined') {
                this.tree = getIndexedFileDataTree(JSON.parse(stateString));
            } else {
                this.tree = getIndexedFileDataTree(initState());
            }

            this.saveState = function() {
                localStorage.setItem(
                    'ru.kozobrodov.fileTree',
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

            this.list = function(path) {
                return this.tree.get(path).children;
            }

        }
        return new JsonDataProvider();
    }

    /**
     * Central part of this plugin, responsible for rendering,
     * UI behaviour and data/state orchestration
     */
    function Core(settings) {
        /**
         * Extracts file name from path. In case of root
         * directory returns element with '<root>' text
         */
        function extractFileName(path) {
            if (path === "") { // Extra case - root directory
                return $('<span>').addClass('meta').append('&lt;root&gt;');
            }
            var fileName = path.replace(/^.*[\\\/]/, '');
            if (fileName.length > 40) {
                var dotIndex = fileName.lastIndexOf(".");
                if (dotIndex > 0 && (fileName.length - dotIndex) < 5) {
                    return fileName.substring(0, 30)
                                + '<span class="meta">&lt;...&gt;</span>'
                                + fileName.substring(dotIndex, fileName.length);
                }
                return fileName.substring(0, 30) + '<span class="meta">&lt;...&gt;</span>';
            }
            return fileName;
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
                var data = settings.dataProvider.list(path);
                var node = settings.stateHolder.addNodes(path, copyChildren(data));
                render(parent.empty(), node);
            }
        }

        function renderItem(element, node) {
            var itemContent = $('<span>')
                .attr('path', node.fileData.path)
                .append(
                    $('<i>').addClass(typeToIcon(node.fileData.type)),
                    ' ',
                    extractFileName(node.fileData.path)
                );
            if (node.fileData.expandable) {
                itemContent
                    .click(expandableNodeClickHandler)
                    .addClass('expandable');
            }
            return $('<li>').append(itemContent).appendTo(element);
        }

        function render(element, tree, deepRender) {
            var item = renderItem(element, tree);
            if (tree.fileData.expandable) {
                if (tree.children.length > 0) {
                    var nested = $('<ul>').addClass('nested');
                    item.append(nested);
                    tree.children.forEach(function(subnode) {
                        if (deepRender) {
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
        stateHolder: getLocalStorageStateHolder(),

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
        dataProvider: {},

        /**
         * Map of file MIME type to appropriate icons classes
         */
        typeToIconClassMap: {
            "directory": "fas fa-folder",
            "application/pdf": "fas fa-file-pdf",
            "application/x-rar": "fas fa-file-archive",
            "application/zip": "fas fa-file-archive",
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
        var settings = $.extend(defaultConfig, config);
        if (typeof settings.jsonLocation !== 'undefined') {
            settings.dataProvider = getJsonDataProvider(settings.jsonLocation);
        }
        return this.each(function(index, e) {
            settings.dataProvider.load(function() {
                new Core(settings).init($(e));
            });
        });
    }
}( jQuery ));