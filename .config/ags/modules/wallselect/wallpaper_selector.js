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
const elevate = etc.widgetCorners === 'normal' ? 'wall-rounding shadow-window' : (etc.widgetCorners === 'none' ? 'elevation shadow-window' : 'shadow-window');
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
    const now = GLib.get_monotonic_time();
    if (wallpaperPathsCache && now - wallpaperPathsCacheTime < CACHE_DURATION) {
        return wallpaperPathsCache;
    }

    const wallDir = Gio.File.new_for_path(WALLPAPER_DIR);
    if (!wallDir.query_exists(null)) {
        try {
            GLib.mkdir_with_parents(WALLPAPER_DIR, 0o755);
        } catch (e) {
            console.error(`Failed to create wallpaper directory: ${e.message}`);
        }
        return [];
    }

    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tga', '.tiff', '.bmp', '.ico'];
    let files = [];
    let enumerator = null;

    try {
        // Get enumerator with error handling
        enumerator = await new Promise((resolve, reject) => {
            const cancellable = new Gio.Cancellable();
            
            const timeout = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                5000, // 5 second timeout
                () => {
                    cancellable.cancel();
                    reject(new Error('Operation timed out'));
                    return GLib.SOURCE_REMOVE;
                }
            );

            wallDir.enumerate_children_async(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (source, res) => {
                    GLib.source_remove(timeout);
                    try {
                        resolve(source.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        // Process files in batches
        while (true) {
            let fileInfos;
            try {
                fileInfos = await new Promise((resolve, reject) => {
                    const cancellable = new Gio.Cancellable();
                    
                    const timeout = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        5000, // 5 second timeout
                        () => {
                            cancellable.cancel();
                            reject(new Error('File enumeration timed out'));
                            return GLib.SOURCE_REMOVE;
                        }
                    );

                    enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, cancellable, (source, res) => {
                        GLib.source_remove(timeout);
                        try {
                            resolve(source.next_files_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            } catch (e) {
                console.error(`Error getting next batch of files: ${e.message}`);
                break;
            }

            if (!fileInfos || fileInfos.length === 0) break;

            // Process the batch of files
            for (const info of fileInfos) {
                try {
                    if (info.get_file_type() === Gio.FileType.REGULAR) {
                        const name = info.get_name();
                        const lastDot = name.lastIndexOf('.');
                        if (lastDot !== -1) {
                            const extension = name.substring(lastDot).toLowerCase();
                            if (validExtensions.includes(extension)) {
                                files.push(GLib.build_filenamev([WALLPAPER_DIR, name]));
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Error processing file ${info ? info.get_name() : 'unknown'}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        console.error(`Failed to list wallpapers: ${e.message}`);
        return [];
    } finally {
        // Always clean up the enumerator
        if (enumerator) {
            try {
                enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
                    try {
                        source.close_finish(res);
                    } catch (e) {
                        console.error('Error closing enumerator:', e.message);
                    }
                });
            } catch (e) {
                console.error('Error during enumerator cleanup:', e.message);
            }
        }
    }

    // Update cache and return results
    wallpaperPathsCache = files;
    wallpaperPathsCacheTime = now;
    return files;
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

const createWallpaperContent = (paths) => {
    if (!paths.length) {
        return searchQuery ? createNoResultsPlaceholder() : createPlaceholder();
    }

    const scrollable = Scrollable({
        hexpand: true,
        vexpand: false,
        hscroll: "always",
        vscroll: "never",
        child: Box({
            className: "wallpaper-list",
            children: paths.map(WallpaperPreview),
        }),
    });

    const eventBox = EventBox({
        onPrimaryClick: () => App.closeWindow("wallselect"),
        onSecondaryClick: () => App.closeWindow("wallselect"),
        onMiddleClick: () => App.closeWindow("wallselect"),
        onScrollUp: () => {
            const adj = scrollable.get_hadjustment();
            adj.set_value(Math.max(adj.get_value() - 120, adj.get_lower()));
        },
        onScrollDown: () => {
            const adj = scrollable.get_hadjustment();
            adj.set_value(Math.min(adj.get_value() + 120, adj.get_upper() - adj.get_page_size()));
        },
        child: scrollable,
    });

    const contentBox = Box({
        setup: (self) => {
            self.add(eventBox);
            self.connect('key-press-event', (_, event) => {
                const keyval = event.get_keyval()[1];
                if (keyval === Gdk.KEY_Left) {
                    const adj = scrollable.get_hadjustment();
                    adj.set_value(Math.max(adj.get_value() - 160, adj.get_lower()));
                    return true;
                } else if (keyval === Gdk.KEY_Right) {
                    const adj = scrollable.get_hadjustment();
                    adj.set_value(Math.min(adj.get_value() + 160, adj.get_upper() - adj.get_page_size()));
                    return true;
                }
                return false;
            });
            self.can_focus = true;
        },
    });

    return contentBox;
};

// Track if an update is in progress to prevent concurrent updates
let isUpdateInProgress = false;

const updateWallpaperContent = async () => {
    // Prevent concurrent updates
    if (isUpdateInProgress) {
        console.log('Update already in progress, skipping concurrent update');
        return;
    }

    if (!wallpaperContentBox || !paginationControls) {
        console.error('Wallpaper content box or pagination controls not initialized');
        return;
    }

    isUpdateInProgress = true;
    let loadingIndicator = null;
    let oldChildren = [];

    try {
        // Show loading state
        loadingIndicator = Box({
            className: 'wallpaper-loading',
            vertical: true,
            vexpand: true,
            hexpand: true,
            children: [
                Label({
                    label: 'Loading...',
                    className: 'txt-large',
                }),
            ],
        });

        // Clear existing content and show loading
        oldChildren = [...wallpaperContentBox.children];
        wallpaperContentBox.add(loadingIndicator);
        wallpaperContentBox.show_all();

        // Process in a background task
        const processWallpapers = async () => {
            try {
                const allPaths = await getWallpaperPaths().catch(e => {
                    console.error('Error getting wallpaper paths:', e);
                    throw new Error('Failed to load wallpaper paths');
                });

                const filteredPaths = allPaths.filter(path => 
                    path && typeof path === 'string' && 
                    path.toLowerCase().includes((searchQuery || '').toLowerCase())
                );

                const totalPages = Math.max(1, Math.ceil(filteredPaths.length / IMAGES_PER_PAGE));
                currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));

                const start = currentPage * IMAGES_PER_PAGE;
                const end = start + IMAGES_PER_PAGE;
                const pagePaths = filteredPaths.slice(start, end);

                // Create new content
                let newContent;
                try {
                    newContent = createWallpaperContent(pagePaths);
                } catch (e) {
                    console.error('Error creating wallpaper content:', e);
                    throw new Error('Failed to create wallpaper previews');
                }


                // Update UI in the main thread
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    try {
                        // Clear existing content
                        wallpaperContentBox.get_children().forEach(child => {
                            if (child !== loadingIndicator) {
                                child.destroy();
                            }
                        });

                        // Add new content
                        wallpaperContentBox.add(newContent);
                        wallpaperContentBox.show_all();

                        // Update pagination controls
                        if (paginationControls.updatePageDisplay) {
                            paginationControls.updatePageDisplay(totalPages);
                        }


                        // Update button states
                        const [first, prev, , next, last] = paginationControls.children;
                        const isFirstPage = currentPage === 0;
                        const isLastPage = currentPage >= totalPages - 1 || totalPages === 0;

                        first.sensitive = !isFirstPage;
                        prev.sensitive = !isFirstPage;
                        next.sensitive = !isLastPage && totalPages > 0;
                        last.sensitive = !isLastPage && totalPages > 0;

                        // Remove loading indicator after a short delay to ensure smooth transition
                        if (loadingIndicator) {
                            loadingIndicator.destroy();
                            loadingIndicator = null;
                        }

                        return GLib.SOURCE_REMOVE;
                    } catch (e) {
                        console.error('Error in UI update:', e);
                        return GLib.SOURCE_REMOVE;
                    }
                });
            } catch (error) {
                console.error('Error in wallpaper update:', error);
                
                // Show error message in the UI
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    try {
                        // Clear existing content
                        wallpaperContentBox.get_children().forEach(child => child.destroy());
                        
                        // Show error message
                        wallpaperContentBox.add(Box({
                            vertical: true,
                            vexpand: true,
                            hexpand: true,
                            className: 'wallpaper-error',
                            children: [
                                Label({
                                    label: 'Error loading wallpapers',
                                    className: 'txt-error txt-large',
                                }),
                                Label({
                                    label: error.message || 'Please try again',
                                    className: 'txt-small txt-muted',
                                }),
                            ],
                        }));
                        
                        wallpaperContentBox.show_all();
                    } catch (e) {
                        console.error('Error showing error message:', e);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } finally {
                isUpdateInProgress = false;
            }
        };

        // Start the background processing
        processWallpapers().catch(e => {
            console.error('Unhandled error in processWallpapers:', e);
            isUpdateInProgress = false;
        });

    } catch (error) {
        console.error('Error in updateWallpaperContent:', error);
        isUpdateInProgress = false;
        
        // Ensure loading indicator is removed on error
        if (loadingIndicator) {
            loadingIndicator.destroy();
        }
        
        // Restore old children if possible
        if (oldChildren.length > 0) {
            wallpaperContentBox.get_children().forEach(child => child.destroy());
            oldChildren.forEach(child => wallpaperContentBox.add(child));
            wallpaperContentBox.show_all();
        }
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
                        updateWallpaperContent().catch(e => console.error('Error updating to first page:', e));
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
                        updateWallpaperContent().catch(e => console.error('Error updating to previous page:', e));
                    }
                },
            }),
            pageInfoLabel,
            Button({
                className: 'wallpaper-pagination-btn',
                child: MaterialIcon('navigate_next', 'norm', { className: 'wallpaper-icon-size' }),
                tooltipText: 'Next page',
                onClicked: () => {
                    currentPage++;
                    updateWallpaperContent().catch(e => console.error('Error updating to next page:', e));
                },
            }),
            Button({
                className: 'wallpaper-pagination-btn',
                child: MaterialIcon('last_page', 'norm', { className: 'wallpaper-icon-size' }),
                tooltipText: 'Last page',
                onClicked: () => {
                    currentPage = 9999; // Set to a large number, updateWallpaperContent will clamp it
                    updateWallpaperContent().catch(e => console.error('Error updating to last page:', e));
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

    return mainWidget;
};
