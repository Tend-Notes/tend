// SPDX-License-Identifier: MIT WITH Commons-Clause
// Knowledge graph visualization using d3-force

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type Simulation, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { drag, type D3DragEvent } from 'd3-drag'
import 'd3-transition' // Import for transition support on selections
import { graph as graphApi } from '../../lib/api'
import type { GraphNode, GraphContentType } from '../../types'
import { usePageStore } from '../../stores/pageStore'

interface SidebarGraphProps {
  onBack: () => void
}

// Extended node type for d3 simulation
interface SimNode extends SimulationNodeDatum, GraphNode {
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

// Extended link type for d3 simulation
interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode | string
  target: SimNode | string
  weight: number
}

// Color palette for content types (base16 colors)
const CONTENT_TYPE_COLORS: Record<string, string> = {
  page: 'var(--base05)',
  journal: 'var(--base0C)',
  // Additional content types get colors from this palette
}

const EXTRA_COLORS = [
  'var(--base0E)', // purple
  'var(--base09)', // orange
  'var(--base0B)', // green
  'var(--base0A)', // yellow
  'var(--base08)', // red
]

function SidebarGraph({ onBack }: SidebarGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const [nodes, setNodes] = useState<SimNode[]>([])
  const [links, setLinks] = useState<SimLink[]>([])
  const [contentTypes, setContentTypes] = useState<GraphContentType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  const { navigateToPage, navigateToJournal, currentPageName } = usePageStore()

  // Build color map for content types
  const contentTypeColors = useMemo(() => {
    const colors = { ...CONTENT_TYPE_COLORS }
    let extraColorIndex = 0
    for (const ct of contentTypes) {
      if (!colors[ct.id]) {
        colors[ct.id] = EXTRA_COLORS[extraColorIndex % EXTRA_COLORS.length]
        extraColorIndex++
      }
    }
    return colors
  }, [contentTypes])

  // Fetch graph data
  useEffect(() => {
    let cancelled = false

    async function fetchGraph() {
      try {
        setLoading(true)
        setError(null)
        const data = await graphApi.get()
        if (cancelled) return

        // Convert to simulation format
        const simNodes: SimNode[] = data.nodes.map((n) => ({
          ...n,
          x: undefined,
          y: undefined,
        }))

        const simLinks: SimLink[] = data.edges.map((e) => ({
          source: e.source,
          target: e.target,
          weight: e.weight,
        }))

        setNodes(simNodes)
        setLinks(simLinks)
        setContentTypes(data.contentTypes || [])
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load graph')
          setLoading(false)
        }
      }
    }

    fetchGraph()
    return () => { cancelled = true }
  }, [])

  // Track container dimensions - re-run when loading changes because the container
  // ref points to different elements in loading vs loaded states
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Try to get initial dimensions immediately via getBoundingClientRect
    const updateDimensions = () => {
      const rect = container.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height })
        return true
      }
      return false
    }

    // Try immediately, retry after brief delay if layout not settled yet
    if (!updateDimensions()) {
      setTimeout(updateDimensions, 50)
    }

    // Use ResizeObserver for subsequent changes
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDimensions({ width, height })
        }
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [loading])

  // Handle node click - defined before useEffect that uses it
  const handleNodeClick = useCallback((node: SimNode) => {
    if (node.contentType === 'journal') {
      // Journal IDs can be "YYYY-MM-DD" or "journal/YYYY-MM-DD"
      const match = node.id.match(/(?:journal\/)?(\d{4}-\d{2}-\d{2})/)
      if (match) {
        navigateToJournal(match[1])
      }
    } else {
      navigateToPage(node.id)
    }
  }, [navigateToPage, navigateToJournal])

  // Calculate node radius based on block count
  const getNodeRadius = useCallback((node: SimNode): number => {
    const minRadius = 6
    const maxRadius = 20
    const scale = Math.min(1, node.blockCount / 50)
    return minRadius + (maxRadius - minRadius) * scale
  }, [])

  // Get node color based on content type
  const getNodeColor = useCallback((node: SimNode): string => {
    if (node.id === currentPageName) {
      return 'var(--base0D)' // Highlight current page
    }
    return contentTypeColors[node.contentType] || 'var(--base05)'
  }, [currentPageName, contentTypeColors])

  // Run force simulation with d3 rendering for zoom/pan/drag support
  useEffect(() => {
    if (nodes.length === 0 || dimensions.width === 0 || dimensions.height === 0) return
    if (!svgRef.current || !gRef.current) return

    const svg = select(svgRef.current)
    const g = select(gRef.current)
    const { width, height } = dimensions

    // Stop previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop()
    }

    // Clear previous content
    g.selectAll('*').remove()

    // Create force simulation centered at origin (we'll transform the view)
    const simulation = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(80)
        .strength(0.3)
      )
      .force('charge', forceManyBody<SimNode>().strength(-200))
      .force('center', forceCenter(0, 0))
      .force('collision', forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 8))

    simulationRef.current = simulation

    // Create links
    const linkSelection = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', 'graph-link')
      .attr('stroke', 'var(--base02)')
      .attr('stroke-width', (d) => Math.max(1, d.weight * 0.5))
      .attr('stroke-opacity', 0.6)

    // Create node groups
    const nodeSelection = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')

    // Add circles to nodes
    nodeSelection.append('circle')
      .attr('class', 'graph-node')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', (d) => getNodeColor(d))
      .attr('stroke', 'transparent')
      .attr('stroke-width', 2)

    // Add labels (hidden by default, shown on hover)
    nodeSelection.append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => getNodeRadius(d) + 14)
      .attr('fill', 'var(--base05)')
      .attr('font-size', '11px')
      .style('pointer-events', 'none')
      .style('user-select', 'none')
      .style('opacity', (d) => d.id === currentPageName ? 1 : 0)
      .text((d) => d.label)

    // Node interactions
    nodeSelection
      .on('mouseenter', function(_event: MouseEvent, d: SimNode) {
        select(this).select('circle')
          .attr('stroke', 'var(--base06)')
        select(this).select('text')
          .style('opacity', 1)
        // Highlight connected links
        linkSelection
          .attr('stroke', (l: SimLink) => {
            const source = (l.source as SimNode).id
            const target = (l.target as SimNode).id
            return source === d.id || target === d.id ? 'var(--base04)' : 'var(--base02)'
          })
          .attr('stroke-opacity', (l: SimLink) => {
            const source = (l.source as SimNode).id
            const target = (l.target as SimNode).id
            return source === d.id || target === d.id ? 1 : 0.6
          })
      })
      .on('mouseleave', function(_event: MouseEvent, d: SimNode) {
        if (d.id !== currentPageName) {
          select(this).select('circle')
            .attr('stroke', 'transparent')
          select(this).select('text')
            .style('opacity', 0)
        }
        linkSelection
          .attr('stroke', 'var(--base02)')
          .attr('stroke-opacity', 0.6)
      })
      .on('click', (event: MouseEvent, d: SimNode) => {
        event.stopPropagation()
        handleNodeClick(d)
      })

    // Drag behavior - track if we're actually dragging to distinguish from clicks
    let isDragging = false
    const dragBehavior = drag<SVGGElement, SimNode>()
      .on('start', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
        isDragging = false
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
        isDragging = true
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
        // If it was a click (no drag movement), navigate
        if (!isDragging) {
          handleNodeClick(d)
        }
      })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeSelection.call(dragBehavior as any)

    // Zoom behavior
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event: { transform: { toString: () => string } }) => {
        g.attr('transform', event.transform.toString())
      })

    svg.call(zoomBehavior)
    zoomRef.current = zoomBehavior

    // Initial transform to center the graph
    const initialTransform = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(0.8)
    svg.call(zoomBehavior.transform, initialTransform)

    // Update positions on each tick
    simulation.on('tick', () => {
      linkSelection
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)

      nodeSelection
        .attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)

      // Update circle positions (they're now relative to group)
      nodeSelection.select('circle')
        .attr('cx', 0)
        .attr('cy', 0)

      nodeSelection.select('text')
        .attr('x', 0)
        .attr('y', 0)
    })

    // Highlight current page
    nodeSelection.filter((d) => d.id === currentPageName)
      .select('circle')
      .attr('stroke', 'var(--base06)')

    return () => {
      simulation.stop()
    }
  }, [nodes, links, dimensions, currentPageName, handleNodeClick, getNodeRadius, getNodeColor])

  if (loading) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <GraphHeader onBack={onBack} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-base-04 text-sm">Loading graph...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <GraphHeader onBack={onBack} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-base-08 text-sm text-center">{error}</div>
        </div>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <GraphHeader onBack={onBack} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-base-04 text-sm text-center">
            No pages yet. Create some pages with [[wiki-links]] to see the graph.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <GraphHeader onBack={onBack} />
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <svg
          ref={svgRef}
          width={dimensions.width || '100%'}
          height={dimensions.height || '100%'}
          className="absolute inset-0"
          style={{ cursor: 'grab' }}
        >
          {/* Transform group - d3 will populate this and apply zoom transforms */}
          <g ref={gRef} />
        </svg>

        {/* Dynamic legend based on content types in graph */}
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-3 text-xs text-base-04 pointer-events-none">
          {contentTypes.map((ct) => (
            <div key={ct.id} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: contentTypeColors[ct.id] || 'var(--base05)' }}
              />
              <span>{ct.name}</span>
            </div>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <button
            onClick={() => {
              if (svgRef.current && zoomRef.current) {
                const svg = select(svgRef.current)
                svg.transition().duration(200).call(zoomRef.current.scaleBy, 1.3)
              }
            }}
            className="w-6 h-6 bg-base-01 border border-base-02 rounded text-base-04 hover:text-base-05 hover:bg-base-02 transition-colors flex items-center justify-center text-sm"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => {
              if (svgRef.current && zoomRef.current) {
                const svg = select(svgRef.current)
                svg.transition().duration(200).call(zoomRef.current.scaleBy, 0.7)
              }
            }}
            className="w-6 h-6 bg-base-01 border border-base-02 rounded text-base-04 hover:text-base-05 hover:bg-base-02 transition-colors flex items-center justify-center text-sm"
            title="Zoom out"
          >
            -
          </button>
          <button
            onClick={() => {
              if (svgRef.current && zoomRef.current) {
                const svg = select(svgRef.current)
                const { width, height } = dimensions
                const resetTransform = zoomIdentity.translate(width / 2, height / 2).scale(0.8)
                svg.transition().duration(300).call(zoomRef.current.transform, resetTransform)
              }
            }}
            className="w-6 h-6 bg-base-01 border border-base-02 rounded text-base-04 hover:text-base-05 hover:bg-base-02 transition-colors flex items-center justify-center text-xs"
            title="Reset view"
          >
            R
          </button>
        </div>
      </div>
    </div>
  )
}

function GraphHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center justify-between p-3 border-b border-base-02">
      <button
        onClick={onBack}
        className="p-1 text-base-04 hover:text-base-05 transition-colors"
        title="Back to navigation"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-sm font-medium text-base-05">Graph</span>
      <div className="w-4" />
    </div>
  )
}

export default SidebarGraph
