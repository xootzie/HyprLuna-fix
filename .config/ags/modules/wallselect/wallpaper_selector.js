import Widget from "resource:///com/github/Aylur/ags/widget.js";
import * as Utils from "resource:///com/github/Aylur/ags/utils.js";
import App from "resource:///com/github/Aylur/ags/app.js";
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gdk from 'gi://Gdk';
import userOptions from '../.configuration/user_options.js';
import { MaterialIcon } from "../.commonwidgets/materialicon.js";
const { Box, Label, EventBox, Scrollable, Button } = Widget;
const { wallselect: opts, etc } = await userOptions.asyncGet();
const elevate = etc.widgetCorners ? "wall-rounding shadow-window" : "elevation shadow-window";
const WALLPAPER_DIR = GLib.get_home_dir() + (opts.wallpaperFolder || '/Pictures/Wallpapers');
// إنشاء المجلد إذا لم يكن موجودا
GLib.mkdir_with_parents(WALLPAPER_DIR, 0o755);
const PREVIEW_WIDTH = opts.width || 200;
const PREVIEW_HEIGHT = opts.height || 120;
const PREVIEW_CORNER = opts.radius || 18;
const HIGH_QUALITY_PREVIEW = opts.highQualityPreview;
const wallpaperStore = GLib.get_user_state_dir() + '/ags/user/current_wallpaper.txt';
const DISK_CACHE_DIR = GLib.get_user_cache_dir() + '/ags/user/wallpapers';
GLib.mkdir_with_parents(DISK_CACHE_DIR, 0o755);

// تحديد عدد الصور في كل صفحة
const IMAGES_PER_PAGE = 30;
// مؤشر الصفحة الحالية
let currentPage = 0;
// State for search
let searchQuery = '';
// Debounce timer
let searchDebounceTimeout = null;

// State variables 
let isSearchVisible = false;
let wallpaperContentBox = null;

// إضافة متغير عام للتحديث
let contentUpdateCallback = null;

const getCacheInfo = (path) => {
    const basename = GLib.path_get_basename(path);
    const dotIndex = basename.lastIndexOf('.');
    const ext = dotIndex !== -1 ? basename.substring(dotIndex + 1).toLowerCase() : "png";
    return { cachedFileName: basename, format: ext === "jpg" ? "jpeg" : ext };
};
const loadPreviewAsync = async (path) => {
    const { cachedFileName, format } = getCacheInfo(path);
    const diskCachePath = DISK_CACHE_DIR + '/' + cachedFileName;
    const diskCacheFile = Gio.File.new_for_path(diskCachePath);
    if (diskCacheFile.query_exists(null)) {
        const originalFile = Gio.File.new_for_path(path);
        try {
            const diskInfo = diskCacheFile.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
            const originalInfo = originalFile.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
            if (originalInfo.get_attribute_uint64('time::modified') <= diskInfo.get_attribute_uint64('time::modified')) {
                try {
                    return GdkPixbuf.Pixbuf.new_from_file(diskCachePath);
                } catch (e) {
                    log(`Error loading disk cached image ${diskCachePath}: ${e}`);
                }
            }
        } catch (e) {
            log(`Error comparing modification times for caching: ${e}`);
        }
    }
    let pixbuf;
    if (path.toLowerCase().endsWith('.gif')) {
        const animation = GdkPixbuf.PixbufAnimation.new_from_file(path);
        pixbuf = animation.get_static_image().scale_simple(PREVIEW_WIDTH, PREVIEW_HEIGHT, GdkPixbuf.InterpType.BILINEAR);
    } else if (HIGH_QUALITY_PREVIEW) {
        pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, PREVIEW_WIDTH, PREVIEW_HEIGHT, true);
    } else {
        const fullPixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
        pixbuf = fullPixbuf.scale_simple(PREVIEW_WIDTH, PREVIEW_HEIGHT, GdkPixbuf.InterpType.NEAREST);
    }
    try {
        // Skip caching GIF files since gdk-pixbuf doesn't support saving them
        if (!path.toLowerCase().endsWith('.gif')) {
        pixbuf.savev(diskCachePath, format, [], []);
        }
    } catch (e) {
        log(`Error saving disk cached image ${diskCachePath}: ${e}`);
    }
    return pixbuf;
};

const cacheWallpapersInBackground = (paths) => {
    if (!paths || paths.length === 0) return;

    let i = 0;
    const cacheNext = () => {
        if (i >= paths.length) return;

        loadPreviewAsync(paths[i])
            .catch(e => console.error(`Failed to cache ${paths[i]} in background: ${e}`))
            .finally(() => {
                i++;
                if (i < paths.length) {
                    Utils.timeout(50, cacheNext);
                }
            });
    };
    Utils.timeout(500, cacheNext);
};

let wallpaperPathsCache = null;
let wallpaperPathsCacheTime = 0;
const CACHE_DURATION = 60 * 1e6;

const getWallpaperPaths = async () => {
    try {
        const now = GLib.get_monotonic_time();
        if (wallpaperPathsCache && now - wallpaperPathsCacheTime < CACHE_DURATION) {
            return wallpaperPathsCache;
        }

        // فحص وجود المجلد
        const dir = Gio.File.new_for_path(WALLPAPER_DIR);
        if (!dir.query_exists(null)) {
            GLib.mkdir_with_parents(WALLPAPER_DIR, 0o755);
            return [];
        }

        try {
            // استخدام Gio لقراءة محتويات المجلد مباشرة بدلاً من الاعتماد على أمر find
            const wallpaperFiles = [];
            const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tga', '.tiff', '.bmp', '.ico'];

            const enumerator = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let fileInfo;

            while ((fileInfo = enumerator.next_file(null)) !== null) {
                // تجاهل المجلدات
                if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                    continue;
                }

                const fileName = fileInfo.get_name();
                const fileExtension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

                if (validExtensions.includes(fileExtension)) {
                    const filePath = WALLPAPER_DIR + '/' + fileName;
                    wallpaperFiles.push(filePath);
                }
            }

            wallpaperPathsCache = wallpaperFiles;
            wallpaperPathsCacheTime = now;

            return wallpaperFiles;
        } catch (error) {
            console.error('خطأ أثناء قراءة المجلد:', error);

            // محاولة الاستخدام بأمر ls كحل بديل إذا فشلت الطريقة السابقة
            const lsCommand = `ls -1 "${WALLPAPER_DIR}" | grep -E "\\.(jpg|jpeg|png|gif|webp|tga|tiff|bmp|ico)$" | awk '{print "${WALLPAPER_DIR}/"$0}'`;

            const files = await Utils.execAsync(['bash', '-c', lsCommand]);

            if (!files || !files.trim()) {
                console.log('لم يتم العثور على صور خلفيات.');
                return [];
            }

            wallpaperPathsCache = files.split("\n").filter(Boolean);
            wallpaperPathsCacheTime = now;

            return wallpaperPathsCache;
        }
    } catch (error) {
        console.error('خطأ أثناء البحث عن الصور:', error);
        return [];
    }
};

const WallpaperPreview = (path) => {
    const basename = GLib.path_get_basename(path);
    return Button({
        className: 'wallpaper-preview-button',
        child: Box({
            vertical: true,
            spacing: 5,
            className: 'wallpaper-container',
            children: [
                // Wrap the wallpaper and its name in a content box
                Box({
                    vertical: true,
                    spacing: 8,
                    className: 'wallpaper-content-box',
                    children: [
                        // Wallpaper image
                        EventBox({
            setup: (self) => {
                const drawingArea = new Gtk.DrawingArea();
                drawingArea.set_size_request(PREVIEW_WIDTH, PREVIEW_HEIGHT);
                self.add(drawingArea);
                let pixbuf = null;
                let imageLoaded = false;
                let loadPromise = null;
                                let mapHandlerId = null;
                                let isDestroyed = false;
                                // Use a variable to reference the drawing area 
                                let drawingAreaRef = drawingArea;

                const loadImage = () => {
                                    if (imageLoaded || loadPromise || isDestroyed) return;
                    loadPromise = Utils.timeout(50, () => {
                                        // Check if widget is still valid before proceeding
                                        if (isDestroyed) return false;

                        loadPreviewAsync(path)
                            .then((p) => {
                                                // Check again if widget is still valid
                                                if (isDestroyed) return;
                                                
                                pixbuf = p;
                                imageLoaded = true;
                                                if (drawingAreaRef && drawingAreaRef.get_mapped()) {
                                                    drawingAreaRef.queue_draw();
                                                }
                            })
                            .catch((e) => {
                                                if (!isDestroyed) {
                                console.error(`Error loading image ${path}: ${e}`);
                                                    if (drawingAreaRef && drawingAreaRef.get_mapped()) {
                                                        drawingAreaRef.queue_draw();
                                                    }
                                                }
                            });
                                        loadPromise = null;
                                        return false;
                    });
                };

                                // Handle widget mapping and unmapping
                                if (drawingAreaRef.get_mapped()) {
                    loadImage();
                } else {
                                    mapHandlerId = drawingAreaRef.connect("map", loadImage);
                }
                                
                                // Clean up when the widget is destroyed
                                const destroyHandlerId = drawingAreaRef.connect("destroy", () => {
                                    isDestroyed = true;
                                    
                                    // Disconnect signals to prevent memory leaks
                                    if (mapHandlerId) {
                                        if (drawingAreaRef) {
                                            drawingAreaRef.disconnect(mapHandlerId);
                                        }
                                        mapHandlerId = null;
                                    }
                                    
                                    if (drawingAreaRef) {
                                        drawingAreaRef.disconnect(destroyHandlerId);
                                    }
                                    
                                    // Cancel any pending operations
                                    if (loadPromise) {
                                        GLib.source_remove(loadPromise);
                                        loadPromise = null;
                                    }
                                    
                                    // Clear references
                                    pixbuf = null;
                                    drawingAreaRef = null;
                                });
                                
                                // Disconnect when unmapped to prevent errors
                                drawingAreaRef.connect("unmap", () => {
                                    if (mapHandlerId && drawingAreaRef) {
                                        drawingAreaRef.disconnect(mapHandlerId);
                                        mapHandlerId = null;
                                    }
                                });

                                drawingAreaRef.connect("draw", (widget, cr) => {
                                    if (pixbuf && !isDestroyed) {
                                        try {
                        const areaWidth = widget.get_allocated_width();
                        const areaHeight = widget.get_allocated_height();
                        cr.save();
                        cr.newPath();
                        cr.arc(PREVIEW_CORNER, PREVIEW_CORNER, PREVIEW_CORNER, Math.PI, 1.5 * Math.PI);
                        cr.arc(areaWidth - PREVIEW_CORNER, PREVIEW_CORNER, PREVIEW_CORNER, 1.5 * Math.PI, 2 * Math.PI);
                        cr.arc(areaWidth - PREVIEW_CORNER, areaHeight - PREVIEW_CORNER, PREVIEW_CORNER, 0, 0.5 * Math.PI);
                        cr.arc(PREVIEW_CORNER, areaHeight - PREVIEW_CORNER, PREVIEW_CORNER, 0.5 * Math.PI, Math.PI);
                        cr.closePath();
                        cr.clip();
                        const scaleX = areaWidth / pixbuf.get_width();
                        const scaleY = areaHeight / pixbuf.get_height();
                        cr.scale(scaleX, scaleY);
                        Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
                        cr.paint();
                        cr.restore();
                                        } catch (e) {
                                            // Silently handle any errors during drawing
                                            console.error(`Error drawing preview: ${e}`);
                                        }
                    }
                    return false;
                });
            }
                        }),
                        
                        // Wallpaper name
                        Label({
                            className: 'wallpaper-name txt-small',
                            truncate: 'end',
                            maxWidthChars: 20,
                            label: basename,
                            hpack: 'center',
                        }),
                    ]
                })
            ]
        }),
        onClicked: async () => {
            try {
                await Utils.execAsync([`bash`, `-c`, `${App.configDir}/scripts/color_generation/colorgen.sh ${path}`]);
                App.closeWindow('wallselect');
            } catch (error) {
                console.error("Error during color generation:", error);
            }
        }
    });
};

const createPlaceholder = () =>
    Box({
        className: 'wallpaper-placeholder',
        vertical: true,
        vexpand: true,
        hexpand: true,
        spacing: 10,
        children: [
            Box({
                vertical: true,
                vpack: 'center',
                hpack: 'center',
                vexpand: true,
                children: [
                    Label({ label: 'No wallpapers found.', className: 'txt-norm onSurfaceVariant' }),
                    Label({ label: 'Add wallpapers to get started.', opacity: 0.8, className: 'txt-small onSurfaceVariant' }),
                ],
            }),
        ],
    });

const createNoResultsPlaceholder = () =>
    Box({
        className: 'wallpaper-placeholder',
        vertical: true,
        vexpand: true,
        hexpand: true,
        spacing: 10,
        children: [
            Box({
                vertical: true,
                vpack: 'center',
                hpack: 'center',
                vexpand: true,
                children: [
                    Label({ 
                        label: 'No matching wallpapers found.', 
                        className: 'txt-norm onSurfaceVariant' 
                    }),
                    Label({ 
                        label: 'Try a different search term.', 
                        opacity: 0.8, 
                        className: 'txt-small onSurfaceVariant' 
                    }),
                ],
            }),
        ],
    });

// Simple debounce function to prevent excessive updates
const debounce = (func, delay) => {
    return (...args) => {
        if (searchDebounceTimeout) {
            GLib.source_remove(searchDebounceTimeout);
        }
        searchDebounceTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            func(...args);
            searchDebounceTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    };
};

// Function to handle keyboard navigation - corrected for AGSv1
const handleKeyNavigation = (_, event) => {
    try {
        // In AGSv1, the keyval is directly available on the event
        const keyval = event.keyval;
        
        // Left arrow key (65361 is KEY_Left in Gdk)
        if (keyval === 65361) {
            return true;
        } 
        // Right arrow key (65363 is KEY_Right in Gdk)
        else if (keyval === 65363) {
            return true;
        }
    } catch (e) {
        console.error("Error in key navigation:", e);
    }
    return false;
};

// Create wallpaper content for the current search query and page
const createWallpaperContent = async () => {
    try {
        const wallpaperPaths = await getWallpaperPaths();

        const filteredPaths = searchQuery
            ? wallpaperPaths.filter(path =>
                GLib.path_get_basename(path).toLowerCase().includes(searchQuery.toLowerCase())
            )
            : wallpaperPaths;

        if (!filteredPaths.length) {
            return {
                content: searchQuery ? createNoResultsPlaceholder() : createPlaceholder(),
                totalPages: 1
            };
        }

        const totalPages = Math.ceil(filteredPaths.length / IMAGES_PER_PAGE);

        if (currentPage >= totalPages) {
            currentPage = Math.max(0, totalPages - 1);
        }
        if (currentPage < 0) {
            currentPage = 0;
        }

        const startIndex = currentPage * IMAGES_PER_PAGE;
        const endIndex = Math.min(startIndex + IMAGES_PER_PAGE, filteredPaths.length);
        const currentPageWallpapers = filteredPaths.slice(startIndex, endIndex);

        // Create a container with keyboard navigation
        const contentBox = Box({
                    setup: (self) => {
                        // Create a scrollable container
                        const scrollable = Scrollable({
                            hexpand: true,
                            vexpand: false,
                            hscroll: "always",
                            vscroll: "never",
                            child: Box({
                                className: "wallpaper-list",
                                children: currentPageWallpapers.map(WallpaperPreview),
                            }),
                        });

                        // Create an event box to handle clicks and scrolling
                        const eventBox = EventBox({
                            onPrimaryClick: () => App.closeWindow("wallselect"),
                            onSecondaryClick: () => App.closeWindow("wallselect"),
                            onMiddleClick: () => App.closeWindow("wallselect"),
                            onScrollUp: () => {
                                // Scroll left when mouse wheel scrolls up
                                const adj = scrollable.get_hadjustment();
                                const scrollAmount = 80; // Reduced scroll amount for smoother scrolling
                                adj.set_value(Math.max(adj.get_value() - scrollAmount, adj.get_lower()));
                            },
                            onScrollDown: () => {
                                // Scroll right when mouse wheel scrolls down
                                const adj = scrollable.get_hadjustment();
                                const scrollAmount = 80; // Reduced scroll amount for smoother scrolling
                                adj.set_value(Math.min(adj.get_value() + scrollAmount, adj.get_upper() - adj.get_page_size()));
                            },
                            child: scrollable,
                        });

                // Add keyboard navigation at widget level
                self.connect('key-press-event', (_, event) => {
                    try {
                        // In AGSv1, the keyval is directly available on the event
                        const keyval = event.keyval;
                        
                        // Left arrow key (65361 is KEY_Left in Gdk)
                        if (keyval === 65361) {
                            const adj = scrollable.get_hadjustment();
                            const scrollAmount = 160;
                            adj.set_value(Math.max(adj.get_value() - scrollAmount, adj.get_lower()));
                            return true;
                        } 
                        // Right arrow key (65363 is KEY_Right in Gdk)
                        else if (keyval === 65363) {
                            const adj = scrollable.get_hadjustment();
                            const scrollAmount = 160;
                            adj.set_value(Math.min(adj.get_value() + scrollAmount, adj.get_upper() - adj.get_page_size()));
                            return true;
                        }
                    } catch (e) {
                        console.error("Error in key navigation:", e);
                    }
                    return false;
                });

                // Make the widget focusable to receive key events
                self.can_focus = true;

                        // Add the event box to the container
                        self.add(eventBox);
                    },
        });

        return {
            content: contentBox,
            totalPages: totalPages
        };
    } catch (error) {
        console.error("Error loading wallpapers:", error);
        return {
            content: Box({
            className: "wallpaper-error",
            vexpand: true,
            hexpand: true,
            children: [Label({ label: "Error loading wallpapers.", className: "txt-large txt-error" })],
            }),
            totalPages: 1
        };
    }
};

// Update just the wallpaper content without recreating the entire widget
const updateWallpaperContent = async () => {
    if (!wallpaperContentBox) return;
    
    try {
        const { content, totalPages } = await createWallpaperContent();
        
        // Update page counter
        if (paginationControls) {
            paginationControls.updatePageDisplay(totalPages);
        }
        
        // Update content
        wallpaperContentBox.children = [content];
    } catch (error) {
        console.error('Error updating wallpaper content:', error);
    }
};

// Persistent pagination controls that don't get recreated
let paginationControls = null;

// Create pagination controls following Material You design
const createPaginationControls = () => {
    // Create a label for page counter
    const pageInfoLabel = Label({
        className: 'wallpaper-pagination-counter',
        xalign: 0.5, // Center align text
        label: '1/1',
    });

    // Debounced search handler
    const performSearch = debounce((text) => {
        searchQuery = text || '';
        currentPage = 0;
        updateWallpaperContent();
    }, 300); // 300ms debounce

    // Create a persistent search entry that doesn't collapse
    const searchEntry = Widget.Entry({
        className: 'wallpaper-search-entry',
        placeholderText: 'Search...',
        hexpand: true,
        onChange: ({ text }) => {
            performSearch(text);
        },
        setup: (self) => {
            // Handle escape key press
            self.connect('key-press-event', (_, event) => {
                if (event.get_keyval()[1] === Gdk.KEY_Escape) {
                    self.text = '';
                    searchQuery = '';
                    updateWallpaperContent();
                    return true;
                }
                return false;
            });
        },
    });

    // Create a revealer for the search entry
    const searchRevealer = Widget.Revealer({
        revealChild: isSearchVisible,
        transition: 'slide_left',
        transitionDuration: 300,
        child: Box({
            child: searchEntry,
            className: 'wallpaper-search-entry-container',
        }),
    });

    // Search button that toggles the revealer
    const searchButton = Button({
        className: 'wallpaper-pagination-btn',
        child: MaterialIcon('search', 'norm', { className: 'wallpaper-icon-size' }),
        tooltipText: 'Search wallpapers',
        onClicked: () => {
            isSearchVisible = !isSearchVisible;
            searchRevealer.revealChild = isSearchVisible;
            if (isSearchVisible) {
                Utils.timeout(50, () => {
                    searchEntry.grab_focus();
                });
            }
        },
    });

    const controls = Box({
        className: 'material-pagination-container',
        hpack: 'center',
        spacing: 4,
        children: [
            Button({
                className: 'wallpaper-pagination-btn',
                child: MaterialIcon('first_page', 'norm', { className: 'wallpaper-icon-size' }),
                tooltipText: 'First page',
                onClicked: () => {
                    if (currentPage !== 0) {
                        currentPage = 0;
                        updateWallpaperContent();
                    }
                },
            }),
            Button({
                className: 'wallpaper-pagination-btn',
                child: MaterialIcon('navigate_before', 'norm', { className: 'wallpaper-icon-size' }),
                tooltipText: 'Previous page',
                onClicked: () => {
                    if (currentPage > 0) {
                        currentPage--;
                        updateWallpaperContent();
                    }
                },
            }),
            pageInfoLabel,
            Button({
                className: 'wallpaper-pagination-btn',
                child: MaterialIcon('navigate_next', 'norm', { className: 'wallpaper-icon-size' }),
                tooltipText: 'Next page',
                onClicked: () => {
                    updateWallpaperContent().then(({ totalPages }) => {
                        if (currentPage < totalPages - 1) {
                            currentPage++;
                            updateWallpaperContent();
                        }
                    });
                },
            }),
            Button({
                className: 'wallpaper-pagination-btn',
                child: MaterialIcon('last_page', 'norm', { className: 'wallpaper-icon-size' }),
                tooltipText: 'Last page',
                onClicked: () => {
                    updateWallpaperContent().then(({ totalPages }) => {
                        if (currentPage !== totalPages - 1) {
                            currentPage = totalPages - 1;
                            updateWallpaperContent();
                        }
                    });
                },
            }),
            Box({ hexpand: true }),
            searchButton,
            searchRevealer,
        ],
    });

    // Add method to update page display
    controls.updatePageDisplay = (totalPages) => {
        pageInfoLabel.label = `${currentPage + 1}/${totalPages}`;
    };

    return controls;
};

export default () => {
    // Create the main widget only once
    const mainWidget = Box({
        vertical: true,
        className: `wallselect-bg ${elevate}`,
        setup: (self) => {
            // Add keyboard navigation at the top level
            self.connect('key-press-event', (_, event) => {
                try {
                    // In AGSv1, the keyval is directly available on the event
                    const keyval = event.keyval;
                    
                    // Handle left/right arrow keys
                    if (keyval === 65361 || keyval === 65363) { // Left: 65361, Right: 65363
                        // Find the scrollable and adjust its position
                        const contentBox = self.get_children()[1];
                        if (contentBox) {
                            const scrollAmount = 160;
                            const possibleScrollables = contentBox.get_children();
                            for (let i = 0; i < possibleScrollables.length; i++) {
                                const child = possibleScrollables[i];
                                if (child instanceof Gtk.ScrolledWindow) {
                                    const adj = child.get_hadjustment();
                                    if (keyval === 65361) { // Left arrow
                                        adj.set_value(Math.max(adj.get_value() - scrollAmount, adj.get_lower()));
                                    } else { // Right arrow
                                        adj.set_value(Math.min(adj.get_value() + scrollAmount, adj.get_upper() - adj.get_page_size()));
                                    }
                                    return true;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error in key navigation:", e);
                }
                return false;
            });
            
            // Make sure the widget can receive focus
            self.can_focus = true;
            
            // Focus the widget after it's shown
            self.connect('map', () => {
                Utils.timeout(100, () => {
                    self.grab_focus();
                });
            });
        },
        children: [
            Box({
                className: "wallselect-header",
                children: [Box({ hexpand: true })],
            }),
            Box({
                vertical: true,
                vpack: "center",
                className: "wallselect-content",
                spacing: 10,
                children: [
                    // Wallpaper content box that will be updated
                    Box({
                        setup: self => {
                            wallpaperContentBox = self;
                        }
                    }),
                    // Create pagination controls only once
                    Box({
                        setup: self => {
                            if (!paginationControls) {
                                paginationControls = createPaginationControls();
                            }
                            self.child = paginationControls;
                        }
                    })
                ],
                setup: (self) => {
                    self.hook(App, async (_, name, visible) => {
                        if (name === "wallselect" && visible) {
                            currentPage = 0;
                            if (searchDebounceTimeout) {
                                GLib.source_remove(searchDebounceTimeout);
                                searchDebounceTimeout = null;
                            }
                            
                            // Initial content update
                            updateWallpaperContent();
                            
                            // Start background caching
                            const wallpaperPaths = await getWallpaperPaths();
                            cacheWallpapersInBackground(wallpaperPaths);
                        }
                    }, "window-toggled");
                },
            }),
        ],
    });

    // Initial content update
    Utils.timeout(100, updateWallpaperContent);

    return mainWidget;
};
