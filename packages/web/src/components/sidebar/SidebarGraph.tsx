// SPDX-License-Identifier: MIT WITH Commons-Clause
// Knowledge graph visualization using d3-force

import { useEffect, useRef, useState, useCallback } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type Simulation, type SimulationNodeDatum, type SimulationLinkDatum } from 'd3-force'
import { select } from 'd3-selection'
import { graph as graphApi } from '../../lib/api'
import type { GraphNode } from '../../types'
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

export function SidebarGraph({ onBack }: SidebarGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null)

  const [nodes, setNodes] = useState<SimNode[]>([])
  const [links, setLinks] = useState<SimLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const { navigateToPage, navigateToJournal, currentPageName } = usePageStore()

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

  // Track container dimensions
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Run force simulation
  useEffect(() => {
    if (nodes.length === 0 || dimensions.width === 0 || dimensions.height === 0) return

    const svg = select(svgRef.current)
    const { width, height } = dimensions

    // Stop previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop()
    }

    // Create force simulation
    const simulation = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(60)
        .strength(0.5)
      )
      .force('charge', forceManyBody<SimNode>().strength(-120))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collision', forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 4))

    simulationRef.current = simulation

    // Update positions on each tick
    simulation.on('tick', () => {
      // Update links
      svg.selectAll<SVGLineElement, SimLink>('.graph-link')
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)

      // Update nodes
      svg.selectAll<SVGCircleElement, SimNode>('.graph-node')
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0)

      // Update labels
      svg.selectAll<SVGTextElement, SimNode>('.graph-label')
        .attr('x', (d) => d.x ?? 0)
        .attr('y', (d) => (d.y ?? 0) + getNodeRadius(d) + 12)
    })

    return () => {
      simulation.stop()
    }
  }, [nodes, links, dimensions])

  // Handle node click
  const handleNodeClick = useCallback((node: SimNode) => {
    if (node.isJournal) {
      // Extract date from journal name (format: journal/YYYY-MM-DD)
      const match = node.id.match(/journal\/(\d{4}-\d{2}-\d{2})/)
      if (match) {
        navigateToJournal(match[1])
      }
    } else {
      navigateToPage(node.id)
    }
  }, [navigateToPage, navigateToJournal])

  // Calculate node radius based on block count
  function getNodeRadius(node: SimNode): number {
    const minRadius = 6
    const maxRadius = 20
    const scale = Math.min(1, node.blockCount / 50)
    return minRadius + (maxRadius - minRadius) * scale
  }

  // Get node color
  function getNodeColor(node: SimNode): string {
    if (node.id === currentPageName) {
      return 'var(--base0D)' // Highlight current page
    }
    if (node.isJournal) {
      return 'var(--base0C)' // Cyan for journals
    }
    return 'var(--base05)' // Default
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col">
        <GraphHeader onBack={onBack} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-base-04 text-sm">Loading graph...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <GraphHeader onBack={onBack} />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-base-08 text-sm text-center">{error}</div>
        </div>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <GraphHeader onBack={onBack} />
      <div ref={containerRef} className="flex-1 relative">
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="absolute inset-0"
        >
          {/* Links */}
          <g className="links">
            {links.map((link, i) => {
              const source = link.source as SimNode
              const target = link.target as SimNode
              const isHighlighted =
                hoveredNode === source.id ||
                hoveredNode === target.id

              return (
                <line
                  key={`${source.id}-${target.id}-${i}`}
                  className="graph-link"
                  x1={source.x ?? 0}
                  y1={source.y ?? 0}
                  x2={target.x ?? 0}
                  y2={target.y ?? 0}
                  stroke={isHighlighted ? 'var(--base04)' : 'var(--base02)'}
                  strokeWidth={Math.max(1, link.weight * 0.5)}
                  strokeOpacity={isHighlighted ? 1 : 0.6}
                  style={{ transition: 'stroke 0.15s, stroke-opacity 0.15s' }}
                />
              )
            })}
          </g>

          {/* Nodes */}
          <g className="nodes">
            {nodes.map((node) => {
              const isHovered = hoveredNode === node.id
              const isCurrent = node.id === currentPageName
              const radius = getNodeRadius(node)

              return (
                <g key={node.id}>
                  <circle
                    className="graph-node"
                    cx={node.x ?? 0}
                    cy={node.y ?? 0}
                    r={radius}
                    fill={getNodeColor(node)}
                    stroke={isHovered || isCurrent ? 'var(--base06)' : 'transparent'}
                    strokeWidth={2}
                    style={{
                      cursor: 'pointer',
                      transition: 'stroke 0.15s, r 0.15s',
                    }}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() => handleNodeClick(node)}
                  />
                  {/* Label - only show on hover or for current page */}
                  {(isHovered || isCurrent) && (
                    <text
                      className="graph-label"
                      x={node.x ?? 0}
                      y={(node.y ?? 0) + radius + 12}
                      textAnchor="middle"
                      fill="var(--base05)"
                      fontSize="11"
                      style={{
                        pointerEvents: 'none',
                        userSelect: 'none',
                      }}
                    >
                      {node.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* Legend */}
        <div className="absolute bottom-2 left-2 flex gap-3 text-xs text-base-04">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--base05)' }} />
            <span>Pages</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--base0C)' }} />
            <span>Journals</span>
          </div>
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
