use anyhow::{Context, Result, anyhow};
use clap::Args;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use wayland_client::protocol::{wl_compositor, wl_registry, wl_surface};
use wayland_client::{Connection, Dispatch, QueueHandle};

use wayland_protocols::wp::idle_inhibit::zv1::client::{
    zwp_idle_inhibit_manager_v1,
    zwp_idle_inhibitor_v1,
};

#[derive(Args, Debug)]
pub struct IdleInhibitorArgs;

// The state of our application.
struct AppState {
    compositor: Option<wl_compositor::WlCompositor>,
    idle_inhibit_manager: Option<zwp_idle_inhibit_manager_v1::ZwpIdleInhibitManagerV1>,
    inhibitor: Option<zwp_idle_inhibitor_v1::ZwpIdleInhibitorV1>,
}

pub fn handle_idle_inhibitor_command(_args: &IdleInhibitorArgs, _debug: bool) -> Result<()> {
    let conn = Connection::connect_to_env()
        .context("Failed to connect to Wayland display")?;

    let mut event_queue = conn.new_event_queue();
    let qh = event_queue.handle();
    let display = conn.display();
    let _registry = display.get_registry(&qh, ());

    let mut state = AppState {
        compositor: None,
        idle_inhibit_manager: None,
        inhibitor: None,
    };

    // First roundtrip to get the globals from the server
    event_queue.roundtrip(&mut state)
        .context("Failed to perform initial Wayland roundtrip")?;

    let compositor = state.compositor.take()
        .ok_or_else(|| anyhow!("Compositor not found"))?;
    let idle_inhibit_manager = state.idle_inhibit_manager.take()
        .ok_or_else(|| anyhow!("Idle inhibit manager not found"))?;

    let surface = compositor.create_surface(&qh, ());
    let inhibitor = idle_inhibit_manager.create_inhibitor(&surface, &qh, ());
    state.inhibitor = Some(inhibitor);

    println!("Idle inhibition enabled. Press Ctrl-C to exit.");

    // Set up a Ctrl-C handler to allow graceful exit
    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();
    ctrlc::set_handler(move || {
        r.store(false, Ordering::SeqCst);
    })
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    // Main event loop
    while running.load(Ordering::SeqCst) {
        event_queue
            .dispatch_pending(&mut state)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    println!("\nShutting down, releasing idle inhibitor...");

    if let Some(inhibitor) = state.inhibitor.take() {
        inhibitor.destroy();
    }
    conn.flush().unwrap();

    Ok(())
}

impl Dispatch<wl_registry::WlRegistry, ()> for AppState {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<AppState>,
    ) {
        if let wl_registry::Event::Global { name, interface, version } = event {
            if interface == "wl_compositor" {
                state.compositor =
                    Some(registry.bind::<wl_compositor::WlCompositor, (), _>(name, version, qh, ()));
            } else if interface == "zwp_idle_inhibit_manager_v1" {
                state.idle_inhibit_manager = Some(registry.bind::<
                    zwp_idle_inhibit_manager_v1::ZwpIdleInhibitManagerV1,
                    (),
                    _,
                >(name, 1, qh, ()));
            }
        }
    }
}

// Implement Dispatch for other protocols to ignore their events
impl Dispatch<wl_compositor::WlCompositor, ()> for AppState {
    fn event(
        _state: &mut Self,
        _: &wl_compositor::WlCompositor,
        _: wl_compositor::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<AppState>,
    ) {}
}

impl Dispatch<zwp_idle_inhibit_manager_v1::ZwpIdleInhibitManagerV1, ()> for AppState {
    fn event(
        _state: &mut Self,
        _: &zwp_idle_inhibit_manager_v1::ZwpIdleInhibitManagerV1,
        _: zwp_idle_inhibit_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<AppState>,
    ) {}
}

impl Dispatch<wl_surface::WlSurface, ()> for AppState {
    fn event(
        _state: &mut Self,
        _: &wl_surface::WlSurface,
        _: wl_surface::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<AppState>,
    ) {}
}

impl Dispatch<zwp_idle_inhibitor_v1::ZwpIdleInhibitorV1, ()> for AppState {
    fn event(
        _state: &mut Self,
        _: &zwp_idle_inhibitor_v1::ZwpIdleInhibitorV1,
        _: zwp_idle_inhibitor_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<AppState>,
    ) {}
}
