import type { Product } from './types.js';

const products: Product[] = [];

export function addProduct(product: Product): void {
  products.push(product);
}

export function getProducts(): Product[] {
  return [...products];
}

export function findProduct(id: number): Product | undefined {
  return products.find(p => p.id === id);
}
