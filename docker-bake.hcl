# The Docker Hub account that publishes the image; no default (owner, 2026-10-12), so a build never tags another account.
# The validation block fails the build when the value is empty (Docker docs, Bake "Variables", "Validating variables":
# https://docs.docker.com/build/bake/variables/#validating-variables).
variable "DOCKERHUB_USERNAME" {
  default = ""
  validation {
    condition = DOCKERHUB_USERNAME != ""
    error_message = "Set DOCKERHUB_USERNAME to the Docker Hub account that publishes the image."
  }
}

variable "VERSION" {
  default = "latest"
}

group "default" {
  targets = ["app"]
}

target "app" {
  context = "."
  dockerfile = "Dockerfile"
  platforms = ["linux/amd64", "linux/arm64"]
  tags = [
    "${DOCKERHUB_USERNAME}/ai-app-hub:${VERSION}",
    "${VERSION}" != "latest" && length(regexall("-", "${VERSION}")) == 0 ? "${DOCKERHUB_USERNAME}/ai-app-hub:latest" : "",
    "${VERSION}" != "latest" && length(regexall("-", "${VERSION}")) > 0 ? "${DOCKERHUB_USERNAME}/ai-app-hub:beta" : ""
  ]
}
