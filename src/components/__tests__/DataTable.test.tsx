/**
 * The table every list in the app is drawn with: headers, sorting, row clicks,
 * and the awkward rows a real book contains.
 */

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DataTable, type Column } from "@/components/DataTable";
import { fireEvent, renderWithProviders, screen, within } from "@/test";

interface Row {
  id: number;
  client: string;
  city: string | null;
  premium: number | null;
}

const rows: Row[] = [
  { id: 1, client: "Rohit Sharma", city: "Pune", premium: 24500 },
  { id: 2, client: "Anita Desai", city: "Mumbai", premium: 31200 },
  { id: 3, client: "Vikram Patel", city: null, premium: null },
];

const columns: Column<Row>[] = [
  { key: "client", header: "Client", sortKey: "client", render: (row) => row.client },
  { key: "city", header: "City", render: (row) => row.city ?? "—" },
  {
    key: "premium",
    header: "Premium",
    sortKey: "premium",
    align: "right",
    render: (row) => (row.premium === null ? "—" : `₹${row.premium}`),
  },
];

/** A header cell, the way a person picks one out: by its label. */
const header = (name: string) => screen.getByRole("columnheader", { name });

/** The rows under the header, without the header row itself. */
const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");

/** The table wired to state, so a second click on a header can reverse it. */
function SortedTable({ onSort }: { onSort?: (key: string, descending: boolean) => void }) {
  const [sort, setSort] = useState("client");
  const [descending, setDescending] = useState(false);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      sort={sort}
      descending={descending}
      onSort={(key) => {
        const next = key === sort ? !descending : false;
        setSort(key);
        setDescending(next);
        onSort?.(key, next);
      }}
    />
  );
}

describe("DataTable", () => {
  it("draws a header for every column and a row for every record", () => {
    renderWithProviders(<DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Client",
      "City",
      "Premium",
    ]);
    expect(bodyRows()).toHaveLength(3);
    expect(within(bodyRows()[0]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Rohit Sharma",
      "Pune",
      "₹24500",
    ]);
  });

  it("shows the empty state instead of the table when there are no rows", () => {
    renderWithProviders(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<p>Nothing in the book yet</p>}
      />,
    );

    expect(screen.getByText("Nothing in the book yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the headers on screen when there are no rows and no empty state", () => {
    renderWithProviders(<DataTable columns={columns} rows={[]} rowKey={(row) => row.id} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(within(screen.getAllByRole("rowgroup")[1]).queryAllByRole("row")).toHaveLength(0);
  });

  // The table has no loading state of its own — a caller holding a query open
  // has to render its own spinner, or the screen reads as an empty book.
  it("shows the empty state rather than a spinner while a caller has no rows yet", () => {
    renderWithProviders(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<p>No policies match</p>}
      />,
    );

    expect(screen.getByText("No policies match")).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("asks the caller to sort when a sortable header is clicked", async () => {
    const onSort = vi.fn();
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} onSort={onSort} />,
    );

    await user.click(header("Premium"));

    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledWith("premium");
  });

  it("reverses the sort when the same header is clicked again", async () => {
    const onSort = vi.fn();
    const { user } = renderWithProviders(<SortedTable onSort={onSort} />);

    await user.click(header("Client"));
    expect(onSort).toHaveBeenLastCalledWith("client", true);

    await user.click(header("Client"));
    expect(onSort).toHaveBeenLastCalledWith("client", false);
  });

  it("starts a newly chosen column ascending", async () => {
    const onSort = vi.fn();
    const { user } = renderWithProviders(<SortedTable onSort={onSort} />);

    await user.click(header("Client"));
    await user.click(header("Premium"));

    expect(onSort).toHaveBeenLastCalledWith("premium", false);
  });

  it("points the indicator up while ascending and down once reversed", async () => {
    const { user } = renderWithProviders(<SortedTable />);

    expect(header("Client").querySelector(".lucide-chevron-up")).toBeInTheDocument();

    await user.click(header("Client"));

    expect(header("Client").querySelector(".lucide-chevron-down")).toBeInTheDocument();
    expect(header("Client").querySelector(".lucide-chevron-up")).not.toBeInTheDocument();
  });

  it("marks only the column the list is sorted by", () => {
    renderWithProviders(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort="premium"
        onSort={vi.fn()}
      />,
    );

    expect(header("Premium").querySelector("svg")).toBeInTheDocument();
    expect(header("Client").querySelector("svg")).not.toBeInTheDocument();
    expect(header("City").querySelector("svg")).not.toBeInTheDocument();
  });

  it("ignores a click on a header with no sort key", async () => {
    const onSort = vi.fn();
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} onSort={onSort} />,
    );

    await user.click(header("City"));

    expect(onSort).not.toHaveBeenCalled();
    expect(header("City")).not.toHaveClass("cursor-pointer");
  });

  it("leaves every column unsortable when no sort handler is given", async () => {
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} sort="client" />,
    );

    await user.click(header("Client"));

    expect(header("Client")).not.toHaveClass("cursor-pointer");
    expect(header("Client").querySelector("svg")).toBeInTheDocument();
  });

  it("hands the whole row back when a row is clicked", async () => {
    const onRowClick = vi.fn();
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} onRowClick={onRowClick} />,
    );

    await user.click(screen.getByText("Anita Desai"));

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("leaves rows inert when no row handler is given", async () => {
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );

    await user.click(screen.getByText("Anita Desai"));

    expect(bodyRows()[1]).not.toHaveClass("cursor-pointer");
  });

  it("aligns the headers and the cells the way the column asks", () => {
    const centred: Column<Row>[] = [
      ...columns,
      { key: "status", header: "Status", align: "center", render: () => "Active" },
    ];
    renderWithProviders(<DataTable columns={centred} rows={rows} rowKey={(row) => row.id} />);

    expect(header("Premium")).toHaveClass("text-right");
    expect(header("Status")).toHaveClass("text-center");
    expect(header("Client")).toHaveClass("text-left");

    const cells = within(bodyRows()[0]).getAllByRole("cell");
    expect(cells[2]).toHaveClass("text-right");
    expect(cells[3]).toHaveClass("text-center");
    expect(cells[0]).not.toHaveClass("text-right");
  });

  it("draws whatever a column renders, including controls of its own", async () => {
    const onRenew = vi.fn();
    const onRowClick = vi.fn();
    const withButton: Column<Row>[] = [
      ...columns,
      {
        key: "actions",
        header: "",
        render: (row) => (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRenew(row);
            }}
          >
            Renew {row.client}
          </button>
        ),
      },
    ];
    const { user } = renderWithProviders(
      <DataTable
        columns={withButton}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Renew Rohit Sharma" }));

    expect(onRenew).toHaveBeenCalledWith(rows[0]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  // A cell that does not stop the click gets the row handler as well, which is
  // the trap every caller with both a link and a row click has to avoid.
  it("still opens the row when a cell's own control lets the click through", async () => {
    const onRowClick = vi.fn();
    const leaky: Column<Row>[] = [
      ...columns,
      { key: "open", header: "", render: () => <button>Open</button> },
    ];
    const { user } = renderWithProviders(
      <DataTable columns={leaky} rows={rows} rowKey={(row) => row.id} onRowClick={onRowClick} />,
    );

    await user.click(screen.getAllByRole("button", { name: "Open" })[0]);

    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("supports selection through a column of its own", async () => {
    const onSelect = vi.fn();
    const selectable: Column<Row>[] = [
      {
        key: "select",
        header: "",
        render: (row) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.client}`}
            onChange={() => onSelect(row.id)}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
      ...columns,
    ];
    const { user } = renderWithProviders(
      <DataTable columns={selectable} rows={rows} rowKey={(row) => row.id} />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Select Vikram Patel" }));

    expect(onSelect).toHaveBeenCalledWith(3);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("draws a row whose values are all missing", () => {
    renderWithProviders(<DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />);

    const cells = within(bodyRows()[2]).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["Vikram Patel", "—", "—"]);
  });

  it("leaves a cell empty when the column renders nothing", () => {
    const sparse: Column<Row>[] = [
      columns[0],
      { key: "city", header: "City", render: (row) => row.city },
    ];
    renderWithProviders(<DataTable columns={sparse} rows={rows} rowKey={(row) => row.id} />);

    expect(within(bodyRows()[2]).getAllByRole("cell")[1]).toBeEmptyDOMElement();
  });

  it("keeps rows apart by the key the caller gives", () => {
    const rowKey = vi.fn((row: Row) => row.id);
    renderWithProviders(<DataTable columns={columns} rows={rows} rowKey={rowKey} />);

    expect(rowKey).toHaveBeenCalledTimes(3);
    expect(rowKey.mock.results.map((result) => result.value)).toEqual([1, 2, 3]);
  });

  it("packs the rows tighter when asked to be dense", () => {
    const { unmount } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} dense />,
    );
    expect(within(bodyRows()[0]).getAllByRole("cell")[0]).toHaveClass("py-1.5");

    unmount();
    renderWithProviders(<DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />);
    expect(within(bodyRows()[0]).getAllByRole("cell")[0]).toHaveClass("py-2.5");
  });

  it("moves focus onto a sortable header when tabbing through the table", async () => {
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} onSort={vi.fn()} />,
    );

    await user.tab();

    expect(header("Client")).toHaveFocus();
  });

  it("sorts when Enter is pressed on a sortable header", () => {
    const onSort = vi.fn();
    renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} onSort={onSort} />,
    );

    fireEvent.keyDown(header("Client"), { key: "Enter" });

    expect(onSort).toHaveBeenCalledWith("client");
  });

  it("tells assistive technology which way the column is sorted", () => {
    renderWithProviders(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort="client"
        onSort={vi.fn()}
      />,
    );

    expect(header("Client")).toHaveAttribute("aria-sort", "ascending");
    expect(header("City")).not.toHaveAttribute("aria-sort");
  });

  it("opens a row from the keyboard", async () => {
    const onRowClick = vi.fn();
    const { user } = renderWithProviders(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} onRowClick={onRowClick} />,
    );

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
