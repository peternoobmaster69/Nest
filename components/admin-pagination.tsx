"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const ADMIN_PAGE_SIZE = 10;

export function useAdminPagination(totalItems: number, pageSize = ADMIN_PAGE_SIZE) {
  const [requestedPage, setRequestedPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  const setPage = (nextPage: number) => {
    setRequestedPage(Math.min(Math.max(1, nextPage), pageCount));
  };

  return { page, pageCount, pageSize, startIndex, endIndex, setPage };
}

export function AdminPagination({
  label,
  totalItems,
  page,
  pageSize = ADMIN_PAGE_SIZE,
  onPageChange,
}: {
  label: string;
  totalItems: number;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems <= pageSize) return null;

  const pageCount = Math.ceil(totalItems / pageSize);
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);

  return (
    <nav className="admin-pagination" aria-label={`${label} pagination`}>
      <p className="admin-pagination-summary">
        Showing <strong>{firstItem}–{lastItem}</strong> of <strong>{totalItems}</strong>
      </p>
      <div className="admin-pagination-controls">
        <Button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
        >
          Previous
        </Button>
        <span className="admin-pagination-page" aria-live="polite">
          Page {page} of {pageCount}
        </span>
        <Button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page === pageCount}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
