import type { Matrix4, OrthographicCamera } from 'three';
import { MIN_COMBAT_ZOOM } from './shared/camera-zoom';

// Both the terrain atlas and live battlefield ink measure cells along the
// orthographic view axes. Each keeps its own stable anchor.
export const BATTLEFIELD_CELL_WORLD_UNITS = 2;

export const battlefieldInkCells = function (camera: OrthographicCamera, width: number, displayZoom: number) {
	const cell = BATTLEFIELD_CELL_WORLD_UNITS * camera.projectionMatrix.elements[0] * width / 2;
	// Reserve capacity for the current zoom range without taking on the cost
	// of the extra-wide view at ordinary combat zooms.
	const wideViewCutoff = 0.5;
	const reserveZoom = displayZoom < wideViewCutoff ? MIN_COMBAT_ZOOM : wideViewCutoff;
	return { cell, minimumCell: cell * Math.min(1, reserveZoom / displayZoom) };
};

// Resolve, line bridging, and bright-cell repair need neighbouring texels.
const guard = 3, border = guard * 2 + 1;
// Count resolved cells. The geometry and paint source uses four taps per cell.
const maxCells = 1_600_000;

interface InkGridOptions {
	width: number;
	height: number;
	cell: number;
	minimumCell: number;
	anchorX: number;
	anchorY: number;
	maxTextureSize: number;
}

export const inkGrid = function ({ width, height, cell, minimumCell, anchorX, anchorY, maxTextureSize }: InkGridOptions) {
	const maxEdge = Math.floor(maxTextureSize / 2);
	if (![width, height, cell, minimumCell, anchorX, anchorY, maxEdge].every(Number.isFinite)
		|| width <= 0 || height <= 0 || minimumCell <= 0 || cell < minimumCell || maxEdge <= border + 1) return undefined;

	const limitWidth = width / minimumCell + border + 1;
	const limitHeight = height / minimumCell + border + 1;
	// Bound the reserved buffer without coarsening a view that already fits.
	const reduction = Math.max(1, limitWidth / maxEdge, limitHeight / maxEdge, Math.sqrt(limitWidth * limitHeight / maxCells));
	const roomX = Math.floor(limitWidth / reduction) - border, roomY = Math.floor(limitHeight / reduction) - border;
	if (roomX <= 0 || roomY <= 0) return undefined;
	const min = reduction === 1 ? minimumCell : Math.max(minimumCell, width / roomX, height / roomY) * (1 + Number.EPSILON);
	const displayCell = Math.max(cell, min);
	const axis = function (span: number, anchor: number, room: number) {
		const offset = -anchor / displayCell;
		return {
			offset: guard + (offset - Math.floor(offset)),
			span: span / displayCell,
			active: Math.ceil(span / displayCell) + border,
			capacity: reduction === 1 ? Math.ceil(span / min) + border : room + border,
		};
	};
	const x = axis(width, anchorX, roomX), y = axis(height, anchorY, roomY);
	if (x.active > x.capacity || y.active > y.capacity || !Number.isFinite(x.offset + y.offset)) return undefined;
	return { x, y };
};


// Move and expand XY clip coordinates to the padded grid. Preserve clip Z
// and W so the raster and display cameras agree on depth.
export const setInkClipTransform = function (transform: Matrix4, { x, y }: NonNullable<ReturnType<typeof inkGrid>>) {
	return transform.set(
		x.span / x.active, 0, 0, (x.span + 2 * x.offset) / x.active - 1,
		0, y.span / y.active, 0, (y.span + 2 * y.offset) / y.active - 1,
		0, 0, 1, 0,
		0, 0, 0, 1,
	);
};
