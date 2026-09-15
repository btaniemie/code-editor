FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn package -q

FROM eclipse-temurin:17-jdk
RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext-base nginx nodejs python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/codereview-server.jar .
COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY start-server.sh .
RUN chmod +x /app/start-server.sh
EXPOSE 8080
CMD ["/app/start-server.sh"]
